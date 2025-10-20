import { describe, it, expect, beforeEach } from "vitest";
import { uintCV, principalCV, bufferCV } from "@stacks/transactions";

const ERR_ELECTION_NOT_FOUND = 200;
const ERR_VOTER_INELIGIBLE = 201;
const ERR_ELECTION_NOT_ACTIVE = 202;
const ERR_VOTER_ALREADY_VOTED = 203;
const ERR_INVALID_VOTE = 204;
const ERR_VOTE_CAST_FAILED = 205;
const ERR_INVALID_PROOF = 206;
const ERR_VOTE_NOT_FOUND = 207;
const ERR_WRONG_CANDIDATE = 208;

interface Vote {
  electionId: number;
  voter: string;
  candidateId: number;
  encryptedBallot: Buffer;
  proofHash: Buffer;
  timestamp: number;
  nonce: number;
  status: boolean;
}

interface VoterVoteKey {
  electionId: number;
  voter: string;
}

class VotingCoreMock {
  state: {
    nextVoteId: number;
    electionAdmin: string | null;
    voterRegistry: string | null;
    voterToken: string | null;
    votes: Map<number, Vote>;
    voterVotes: Map<string, number>;
  } = {
    nextVoteId: 0,
    electionAdmin: null,
    voterRegistry: null,
    voterToken: null,
    votes: new Map(),
    voterVotes: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1VOTER";

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextVoteId: 0,
      electionAdmin: null,
      voterRegistry: null,
      voterToken: null,
      votes: new Map(),
      voterVotes: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1VOTER";
  }

  setDependencies(admin: string, registry: string, token: string): boolean {
    if (this.state.electionAdmin || this.state.voterRegistry || this.state.voterToken) {
      return false;
    }
    this.state.electionAdmin = admin;
    this.state.voterRegistry = registry;
    this.state.voterToken = token;
    return true;
  }

  isElectionActive(electionId: number): boolean {
    return true;
  }

  isVoterEligible(electionId: number, voter: string): boolean {
    return voter === "ST1VOTER" || voter === "ST2VOTER";
  }

  burnVotingToken(electionId: number, voter: string): boolean {
    return true;
  }

  castVote(
    electionId: number,
    candidateId: number,
    encryptedBallot: Buffer,
    proofHash: Buffer,
    nonce: number
  ): { ok: boolean; value: number | number } {
    if (!this.state.electionAdmin) return { ok: false, value: ERR_ELECTION_NOT_FOUND };
    if (!this.isElectionActive(electionId)) return { ok: false, value: ERR_ELECTION_NOT_ACTIVE };
    if (!this.isVoterEligible(electionId, this.caller)) return { ok: false, value: ERR_VOTER_INELIGIBLE };
    
    const voterKey = `${electionId}:${this.caller}`;
    if (this.state.voterVotes.has(voterKey)) return { ok: false, value: ERR_VOTER_ALREADY_VOTED };
    if (encryptedBallot.length === 0) return { ok: false, value: ERR_INVALID_VOTE };
    if (proofHash.length !== 32) return { ok: false, value: ERR_INVALID_PROOF };
    if (!this.burnVotingToken(electionId, this.caller)) return { ok: false, value: 209 };

    const voteId = this.state.nextVoteId;
    const vote: Vote = {
      electionId,
      voter: this.caller,
      candidateId,
      encryptedBallot,
      proofHash,
      timestamp: this.blockHeight,
      nonce,
      status: true,
    };

    this.state.votes.set(voteId, vote);
    this.state.voterVotes.set(voterKey, voteId);
    this.state.nextVoteId++;
    return { ok: true, value: voteId };
  }

  verifyVote(
    voteId: number,
    expectedCandidate: number,
    expectedProof: Buffer
  ): { ok: boolean; value: { electionId: number; voter: string; timestamp: number; verified: boolean } | number } {
    const vote = this.state.votes.get(voteId);
    if (!vote || !vote.status) return { ok: false, value: ERR_VOTE_NOT_FOUND };
    if (vote.candidateId !== expectedCandidate) return { ok: false, value: ERR_WRONG_CANDIDATE };
    if (!expectedProof.equals(vote.proofHash)) return { ok: false, value: ERR_INVALID_PROOF };
    
    return {
      ok: true,
      value: {
        electionId: vote.electionId,
        voter: vote.voter,
        timestamp: vote.timestamp,
        verified: true,
      },
    };
  }

  challengeVote(voteId: number): { ok: boolean; value: boolean | number } {
    const vote = this.state.votes.get(voteId);
    if (!vote || !vote.status) return { ok: false, value: ERR_VOTE_NOT_FOUND };
    
    this.state.votes.set(voteId, { ...vote, status: false });
    return { ok: true, value: true };
  }

  getVote(voteId: number): Vote | null {
    return this.state.votes.get(voteId) || null;
  }

  hasVoted(electionId: number, voter: string): boolean {
    return this.state.voterVotes.has(`${electionId}:${voter}`);
  }
}

describe("VotingCore", () => {
  let contract: VotingCoreMock;

  beforeEach(() => {
    contract = new VotingCoreMock();
    contract.reset();
    contract.setDependencies("ST1ADMIN", "ST1REGISTRY", "ST1TOKEN");
  });

  it("rejects double voting", () => {
    const ballot = Buffer.alloc(128, 2);
    const proof = Buffer.alloc(32, 3);
    
    contract.castVote(1, 5, ballot, proof, 123);
    const result = contract.castVote(1, 6, ballot, proof, 456);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_VOTER_ALREADY_VOTED);
  });

  it("rejects ineligible voter", () => {
    contract.caller = "ST3INVALID";
    const ballot = Buffer.alloc(128, 4);
    const proof = Buffer.alloc(32, 5);
    
    const result = contract.castVote(1, 5, ballot, proof, 789);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_VOTER_INELIGIBLE);
  });

  it("rejects invalid ballot", () => {
    const emptyBallot = Buffer.alloc(0);
    const proof = Buffer.alloc(32, 6);
    
    const result = contract.castVote(1, 5, emptyBallot, proof, 101);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_VOTE);
  });

  it("rejects invalid proof hash", () => {
    const ballot = Buffer.alloc(128, 7);
    const shortProof = Buffer.alloc(16, 8);
    
    const result = contract.castVote(1, 5, ballot, shortProof, 202);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PROOF);
  });

  it("verifies vote successfully", () => {
    const ballot = Buffer.alloc(128, 9);
    const proof = Buffer.alloc(32, 10);
    
    contract.castVote(1, 5, ballot, proof, 303);
    const verifyResult = contract.verifyVote(0, 5, proof);
    expect(verifyResult.ok).toBe(true);
    expect(verifyResult.value).toMatchObject({
      electionId: 1,
      verified: true,
    });
  });

  it("rejects verification with wrong candidate", () => {
    const ballot = Buffer.alloc(128, 11);
    const proof = Buffer.alloc(32, 12);
    
    contract.castVote(1, 5, ballot, proof, 404);
    const verifyResult = contract.verifyVote(0, 6, proof);
    expect(verifyResult.ok).toBe(false);
    expect(verifyResult.value).toBe(ERR_WRONG_CANDIDATE);
  });

  it("rejects verification with wrong proof", () => {
    const ballot = Buffer.alloc(128, 13);
    const proof1 = Buffer.alloc(32, 14);
    const proof2 = Buffer.alloc(32, 15);
    
    contract.castVote(1, 5, ballot, proof1, 505);
    const verifyResult = contract.verifyVote(0, 5, proof2);
    expect(verifyResult.ok).toBe(false);
    expect(verifyResult.value).toBe(ERR_INVALID_PROOF);
  });

  it("challenges vote successfully", () => {
    const ballot = Buffer.alloc(128, 16);
    const proof = Buffer.alloc(32, 17);
    
    contract.castVote(1, 5, ballot, proof, 606);
    const challengeResult = contract.challengeVote(0);
    expect(challengeResult.ok).toBe(true);
    expect(challengeResult.value).toBe(true);
    
    const vote = contract.getVote(0);
    expect(vote?.status).toBe(false);
  });

  it("rejects challenge on non-existent vote", () => {
    const challengeResult = contract.challengeVote(999);
    expect(challengeResult.ok).toBe(false);
    expect(challengeResult.value).toBe(ERR_VOTE_NOT_FOUND);
  });

  it("rejects vote without dependencies", () => {
    contract.reset();
    const ballot = Buffer.alloc(128, 18);
    const proof = Buffer.alloc(32, 19);
    
    const result = contract.castVote(1, 5, ballot, proof, 707);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ELECTION_NOT_FOUND);
  });
});