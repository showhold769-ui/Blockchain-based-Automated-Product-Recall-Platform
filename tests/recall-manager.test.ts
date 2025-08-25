// RecallManager.test.ts
import { describe, expect, it, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface RecallRecord {
  batchHash: string; // Represent buff as hex string
  initiator: string;
  timestamp: number;
  status: string;
  reason: string;
  affectedCount: number;
  resolutionNotes: string | null;
  expiryBlock: number;
}

interface BatchStatus {
  activeRecall: boolean;
  recallId: number | null;
  lastUpdated: number;
}

interface Dispute {
  disputer: string;
  notes: string;
  timestamp: number;
  resolved: boolean;
  resolution: string | null;
}

interface VerifierVote {
  vote: boolean;
  timestamp: number;
}

interface RecallMetadata {
  additionalData: string; // buff as hex
  linkedReports: number[];
}

interface ContractState {
  recalls: Map<number, RecallRecord>;
  batchRecallStatus: Map<string, BatchStatus>;
  disputes: Map<number, Dispute>;
  recallVerifiers: Map<string, VerifierVote>; // Key as `${recallId}-${verifier}`
  recallMetadata: Map<number, RecallMetadata>;
  contractOwner: string;
  paused: boolean;
  autoRecallThreshold: number;
  recallCounter: number;
}

// Mock traits - simple objects with methods
class MockBatchRegistry {
  private registeredBatches: Set<string> = new Set();

  registerBatch(hash: string) {
    this.registeredBatches.add(hash);
  }

  isBatchRegistered(hash: string): ClarityResponse<boolean> {
    return { ok: true, value: this.registeredBatches.has(hash) };
  }

  getBatchDetails(hash: string): ClarityResponse<{owner: string, metadata: string, createdAt: number}> {
    return { ok: true, value: { owner: 'deployer', metadata: 'test', createdAt: 1 } };
  }
}

class MockContaminationReporter {
  private reports: Map<string, number> = new Map(); // batchHash -> count

  addReport(batchHash: string) {
    const count = this.reports.get(batchHash) ?? 0;
    this.reports.set(batchHash, count + 1);
  }

  getReportCountForBatch(batchHash: string): ClarityResponse<number> {
    return { ok: true, value: this.reports.get(batchHash) ?? 0 };
  }

  getReportDetails(id: number): ClarityResponse<any> {
    return { ok: true, value: {} };
  }
}

class MockNotificationHub {
  sendAlert(caller: string, message: string, batchHash: string, recallId: number): ClarityResponse<boolean> {
    return { ok: true, value: true };
  }
}

class MockIncentivePool {
  rewardReporter(reporter: string, amount: number): ClarityResponse<boolean> {
    return { ok: true, value: true };
  }
}

// Mock contract implementation
class RecallManagerMock {
  private state: ContractState = {
    recalls: new Map(),
    batchRecallStatus: new Map(),
    disputes: new Map(),
    recallVerifiers: new Map(),
    recallMetadata: new Map(),
    contractOwner: 'deployer',
    paused: false,
    autoRecallThreshold: 3,
    recallCounter: 0,
  };

  private ERR_UNAUTHORIZED = 100;
  private ERR_INVALID_BATCH = 101;
  private ERR_ALREADY_RECALLED = 102;
  private ERR_INSUFFICIENT_REPORTS = 103;
  private ERR_INVALID_STATUS = 104;
  private ERR_DISPUTE_EXISTS = 105;
  private ERR_NO_DISPUTE = 106;
  private ERR_PAUSED = 107;
  private ERR_INVALID_THRESHOLD = 108;
  private ERR_METADATA_TOO_LONG = 109;
  private ERR_INVALID_DURATION = 110;
  private MAX_METADATA_LEN = 512;
  private MAX_DISPUTE_NOTES_LEN = 256;
  private DEFAULT_RECALL_DURATION = 1440;
  private blockHeight = 1000; // Simulated block height

  private incrementBlockHeight() {
    this.blockHeight += 1;
  }

  getRecallDetails(recallId: number): ClarityResponse<RecallRecord | null> {
    return { ok: true, value: this.state.recalls.get(recallId) ?? null };
  }

  getBatchRecallStatus(batchHash: string): ClarityResponse<BatchStatus | null> {
    return { ok: true, value: this.state.batchRecallStatus.get(batchHash) ?? null };
  }

  getDisputeDetails(recallId: number): ClarityResponse<Dispute | null> {
    return { ok: true, value: this.state.disputes.get(recallId) ?? null };
  }

  getRecallVerifierVote(recallId: number, verifier: string): ClarityResponse<VerifierVote | null> {
    return { ok: true, value: this.state.recallVerifiers.get(`${recallId}-${verifier}`) ?? null };
  }

  getRecallMetadata(recallId: number): ClarityResponse<RecallMetadata | null> {
    return { ok: true, value: this.state.recallMetadata.get(recallId) ?? null };
  }

  getAutoRecallThreshold(): ClarityResponse<number> {
    return { ok: true, value: this.state.autoRecallThreshold };
  }

  getContractOwner(): ClarityResponse<string> {
    return { ok: true, value: this.state.contractOwner };
  }

  isContractPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  getRecallCounter(): ClarityResponse<number> {
    return { ok: true, value: this.state.recallCounter };
  }

  initiateRecall(
    batchHash: string,
    reason: string,
    linkedReports: number[],
    additionalData: string,
    batchRegistry: MockBatchRegistry,
    reporter: MockContaminationReporter,
    notificationHub: MockNotificationHub,
    incentivePool: MockIncentivePool,
    caller: string = 'user1'
  ): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const batchRegistered = batchRegistry.isBatchRegistered(batchHash);
    if (!batchRegistered.value) {
      return { ok: false, value: this.ERR_INVALID_BATCH };
    }
    const batchStatus = this.state.batchRecallStatus.get(batchHash);
    if (batchStatus && batchStatus.activeRecall) {
      return { ok: false, value: this.ERR_ALREADY_RECALLED };
    }
    const reportCount = reporter.getReportCountForBatch(batchHash);
    if (reportCount.value < this.state.autoRecallThreshold) {
      return { ok: false, value: this.ERR_INSUFFICIENT_REPORTS };
    }
    if (additionalData.length > this.MAX_METADATA_LEN) {
      return { ok: false, value: this.ERR_METADATA_TOO_LONG };
    }
    this.state.recallCounter += 1;
    const recallId = this.state.recallCounter;
    this.state.recalls.set(recallId, {
      batchHash,
      initiator: caller,
      timestamp: this.blockHeight,
      status: 'initiated',
      reason,
      affectedCount: 0,
      resolutionNotes: null,
      expiryBlock: this.blockHeight + this.DEFAULT_RECALL_DURATION,
    });
    this.state.batchRecallStatus.set(batchHash, {
      activeRecall: true,
      recallId,
      lastUpdated: this.blockHeight,
    });
    this.state.recallMetadata.set(recallId, {
      additionalData,
      linkedReports,
    });
    notificationHub.sendAlert(caller, 'Recall Initiated', batchHash, recallId);
    incentivePool.rewardReporter(caller, 100);
    this.incrementBlockHeight();
    return { ok: true, value: recallId };
  }

  verifyRecall(recallId: number, vote: boolean, caller: string): ClarityResponse<boolean> {
    const recall = this.state.recalls.get(recallId);
    if (!recall) {
      return { ok: false, value: this.ERR_INVALID_BATCH };
    }
    if (recall.status !== 'initiated') {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    const key = `${recallId}-${caller}`;
    if (this.state.recallVerifiers.has(key)) {
      return { ok: false, value: this.ERR_ALREADY_RECALLED };
    }
    this.state.recallVerifiers.set(key, {
      vote,
      timestamp: this.blockHeight,
    });
    this.incrementBlockHeight();
    return { ok: true, value: true };
  }

  disputeRecall(recallId: number, notes: string, caller: string): ClarityResponse<boolean> {
    const recall = this.state.recalls.get(recallId);
    if (!recall) {
      return { ok: false, value: this.ERR_INVALID_BATCH };
    }
    if (recall.status !== 'initiated') {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    if (this.state.disputes.has(recallId)) {
      return { ok: false, value: this.ERR_DISPUTE_EXISTS };
    }
    if (notes.length > this.MAX_DISPUTE_NOTES_LEN) {
      return { ok: false, value: this.ERR_METADATA_TOO_LONG };
    }
    this.state.disputes.set(recallId, {
      disputer: caller,
      notes,
      timestamp: this.blockHeight,
      resolved: false,
      resolution: null,
    });
    recall.status = 'disputed';
    this.state.recalls.set(recallId, recall);
    this.incrementBlockHeight();
    return { ok: true, value: true };
  }

  resolveDispute(recallId: number, resolution: string, newStatus: string, caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    const dispute = this.state.disputes.get(recallId);
    if (!dispute) {
      return { ok: false, value: this.ERR_NO_DISPUTE };
    }
    const recall = this.state.recalls.get(recallId);
    if (!recall) {
      return { ok: false, value: this.ERR_INVALID_BATCH };
    }
    if (dispute.resolved) {
      return { ok: false, value: this.ERR_ALREADY_RECALLED };
    }
    if (newStatus !== 'verified' && newStatus !== 'resolved') {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    dispute.resolved = true;
    dispute.resolution = resolution;
    this.state.disputes.set(recallId, dispute);
    recall.status = newStatus;
    recall.resolutionNotes = resolution;
    this.state.recalls.set(recallId, recall);
    this.incrementBlockHeight();
    return { ok: true, value: true };
  }

  updateRecallStatus(recallId: number, newStatus: string, notes: string | null, caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    const recall = this.state.recalls.get(recallId);
    if (!recall) {
      return { ok: false, value: this.ERR_INVALID_BATCH };
    }
    if (newStatus !== 'verified' && newStatus !== 'resolved' && newStatus !== 'disputed') {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    recall.status = newStatus;
    recall.resolutionNotes = notes;
    this.state.recalls.set(recallId, recall);
    if (newStatus === 'resolved') {
      const batchStatus = this.state.batchRecallStatus.get(recall.batchHash);
      if (batchStatus) {
        batchStatus.activeRecall = false;
        this.state.batchRecallStatus.set(recall.batchHash, batchStatus);
      }
    }
    this.incrementBlockHeight();
    return { ok: true, value: true };
  }

  setAutoRecallThreshold(newThreshold: number, caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (newThreshold < 3) {
      return { ok: false, value: this.ERR_INVALID_THRESHOLD };
    }
    this.state.autoRecallThreshold = newThreshold;
    return { ok: true, value: true };
  }

  pauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  transferOwnership(newOwner: string, caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.contractOwner = newOwner;
    return { ok: true, value: true };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  user1: "wallet_1",
  user2: "wallet_2",
};

describe("RecallManager Contract", () => {
  let contract: RecallManagerMock;
  let batchRegistry: MockBatchRegistry;
  let contaminationReporter: MockContaminationReporter;
  let notificationHub: MockNotificationHub;
  let incentivePool: MockIncentivePool;

  beforeEach(() => {
    contract = new RecallManagerMock();
    batchRegistry = new MockBatchRegistry();
    contaminationReporter = new MockContaminationReporter();
    notificationHub = new MockNotificationHub();
    incentivePool = new MockIncentivePool();
  });

  it("should initialize with correct defaults", () => {
    expect(contract.getAutoRecallThreshold()).toEqual({ ok: true, value: 3 });
    expect(contract.getContractOwner()).toEqual({ ok: true, value: "deployer" });
    expect(contract.isContractPaused()).toEqual({ ok: true, value: false });
    expect(contract.getRecallCounter()).toEqual({ ok: true, value: 0 });
  });

  it("should allow initiating a recall with sufficient reports", () => {
    const batchHash = "0x1234";
    batchRegistry.registerBatch(batchHash);
    contaminationReporter.addReport(batchHash);
    contaminationReporter.addReport(batchHash);
    contaminationReporter.addReport(batchHash);

    const result = contract.initiateRecall(
      batchHash,
      "Contamination detected",
      [1, 2, 3],
      "additional data",
      batchRegistry,
      contaminationReporter,
      notificationHub,
      incentivePool,
      accounts.user1
    );
    expect(result).toEqual({ ok: true, value: 1 });

    const details = contract.getRecallDetails(1);
    expect(details.value?.status).toBe("initiated");
    expect(details.value?.initiator).toBe(accounts.user1);

    const status = contract.getBatchRecallStatus(batchHash);
    expect(status.value?.activeRecall).toBe(true);

    const metadata = contract.getRecallMetadata(1);
    expect(metadata.value?.linkedReports).toEqual([1, 2, 3]);
  });

  it("should prevent initiating recall without registered batch", () => {
    const result = contract.initiateRecall(
      "0xinvalid",
      "reason",
      [],
      "",
      batchRegistry,
      contaminationReporter,
      notificationHub,
      incentivePool
    );
    expect(result).toEqual({ ok: false, value: 101 });
  });

  it("should prevent initiating recall with insufficient reports", () => {
    const batchHash = "0x1234";
    batchRegistry.registerBatch(batchHash);
    contaminationReporter.addReport(batchHash); // Only 1

    const result = contract.initiateRecall(
      batchHash,
      "reason",
      [],
      "",
      batchRegistry,
      contaminationReporter,
      notificationHub,
      incentivePool
    );
    expect(result).toEqual({ ok: false, value: 103 });
  });

  it("should prevent initiating recall when paused", () => {
    contract.pauseContract(accounts.deployer);
    const result = contract.initiateRecall(
      "0x1234",
      "reason",
      [],
      "",
      batchRegistry,
      contaminationReporter,
      notificationHub,
      incentivePool
    );
    expect(result).toEqual({ ok: false, value: 107 });
  });

  it("should allow verifying a recall", () => {
    // Setup recall
    const batchHash = "0x1234";
    batchRegistry.registerBatch(batchHash);
    for (let i = 0; i < 3; i++) {
      contaminationReporter.addReport(batchHash);
    }
    contract.initiateRecall(
      batchHash,
      "reason",
      [],
      "",
      batchRegistry,
      contaminationReporter,
      notificationHub,
      incentivePool
    );

    const result = contract.verifyRecall(1, true, accounts.user2);
    expect(result).toEqual({ ok: true, value: true });

    const vote = contract.getRecallVerifierVote(1, accounts.user2);
    expect(vote.value?.vote).toBe(true);
  });

  it("should prevent duplicate verification votes", () => {
    // Setup
    const batchHash = "0x1234";
    batchRegistry.registerBatch(batchHash);
    for (let i = 0; i < 3; i++) {
      contaminationReporter.addReport(batchHash);
    }
    contract.initiateRecall(
      batchHash,
      "reason",
      [],
      "",
      batchRegistry,
      contaminationReporter,
      notificationHub,
      incentivePool
    );

    contract.verifyRecall(1, true, accounts.user2);
    const duplicate = contract.verifyRecall(1, false, accounts.user2);
    expect(duplicate).toEqual({ ok: false, value: 102 });
  });

  it("should allow disputing a recall", () => {
    // Setup
    const batchHash = "0x1234";
    batchRegistry.registerBatch(batchHash);
    for (let i = 0; i < 3; i++) {
      contaminationReporter.addReport(batchHash);
    }
    contract.initiateRecall(
      batchHash,
      "reason",
      [],
      "",
      batchRegistry,
      contaminationReporter,
      notificationHub,
      incentivePool
    );

    const result = contract.disputeRecall(1, "Invalid claim", accounts.user2);
    expect(result).toEqual({ ok: true, value: true });

    const details = contract.getRecallDetails(1);
    expect(details.value?.status).toBe("disputed");

    const dispute = contract.getDisputeDetails(1);
    expect(dispute.value?.disputer).toBe(accounts.user2);
  });

  it("should prevent disputing non-initiated recall", () => {
    const result = contract.disputeRecall(999, "notes", accounts.user1);
    expect(result).toEqual({ ok: false, value: 101 });
  });

  it("should allow owner to resolve dispute", () => {
    // Setup dispute
    const batchHash = "0x1234";
    batchRegistry.registerBatch(batchHash);
    for (let i = 0; i < 3; i++) {
      contaminationReporter.addReport(batchHash);
    }
    contract.initiateRecall(
      batchHash,
      "reason",
      [],
      "",
      batchRegistry,
      contaminationReporter,
      notificationHub,
      incentivePool
    );
    contract.disputeRecall(1, "notes", accounts.user1);

    const result = contract.resolveDispute(1, "Resolved in favor", "verified", accounts.deployer);
    expect(result).toEqual({ ok: true, value: true });

    const dispute = contract.getDisputeDetails(1);
    expect(dispute.value?.resolved).toBe(true);
    expect(dispute.value?.resolution).toBe("Resolved in favor");

    const recall = contract.getRecallDetails(1);
    expect(recall.value?.status).toBe("verified");
    expect(recall.value?.resolutionNotes).toBe("Resolved in favor");
  });

  it("should prevent non-owner from resolving dispute", () => {
    const result = contract.resolveDispute(1, "resolution", "verified", accounts.user1);
    expect(result).toEqual({ ok: false, value: 100 });
  });

  it("should allow owner to update recall status", () => {
    // Setup
    const batchHash = "0x1234";
    batchRegistry.registerBatch(batchHash);
    for (let i = 0; i < 3; i++) {
      contaminationReporter.addReport(batchHash);
    }
    contract.initiateRecall(
      batchHash,
      "reason",
      [],
      "",
      batchRegistry,
      contaminationReporter,
      notificationHub,
      incentivePool
    );

    const result = contract.updateRecallStatus(1, "resolved", "All cleared", accounts.deployer);
    expect(result).toEqual({ ok: true, value: true });

    const recall = contract.getRecallDetails(1);
    expect(recall.value?.status).toBe("resolved");

    const status = contract.getBatchRecallStatus(batchHash);
    expect(status.value?.activeRecall).toBe(false);
  });

  it("should prevent non-owner from updating status", () => {
    const result = contract.updateRecallStatus(1, "verified", null, accounts.user1);
    expect(result).toEqual({ ok: false, value: 100 });
  });

  it("should allow owner to set auto recall threshold", () => {
    const result = contract.setAutoRecallThreshold(5, accounts.deployer);
    expect(result).toEqual({ ok: true, value: true });
    expect(contract.getAutoRecallThreshold()).toEqual({ ok: true, value: 5 });
  });

  it("should prevent setting invalid threshold", () => {
    const result = contract.setAutoRecallThreshold(2, accounts.deployer);
    expect(result).toEqual({ ok: false, value: 108 });
  });

  it("should allow owner to pause and unpause", () => {
    let result = contract.pauseContract(accounts.deployer);
    expect(result).toEqual({ ok: true, value: true });
    expect(contract.isContractPaused()).toEqual({ ok: true, value: true });

    result = contract.unpauseContract(accounts.deployer);
    expect(result).toEqual({ ok: true, value: true });
    expect(contract.isContractPaused()).toEqual({ ok: true, value: false });
  });

  it("should prevent non-owner from pausing", () => {
    const result = contract.pauseContract(accounts.user1);
    expect(result).toEqual({ ok: false, value: 100 });
  });

  it("should allow owner to transfer ownership", () => {
    const result = contract.transferOwnership(accounts.user1, accounts.deployer);
    expect(result).toEqual({ ok: true, value: true });
    expect(contract.getContractOwner()).toEqual({ ok: true, value: accounts.user1 });
  });

  it("should prevent non-owner from transferring ownership", () => {
    const result = contract.transferOwnership(accounts.user2, accounts.user1);
    expect(result).toEqual({ ok: false, value: 100 });
  });

  it("should prevent metadata exceeding max length in initiate", () => {
    const batchHash = "0x1234";
    batchRegistry.registerBatch(batchHash);
    for (let i = 0; i < 3; i++) {
      contaminationReporter.addReport(batchHash);
    }
    const longData = "a".repeat(513);
    const result = contract.initiateRecall(
      batchHash,
      "reason",
      [],
      longData,
      batchRegistry,
      contaminationReporter,
      notificationHub,
      incentivePool
    );
    expect(result).toEqual({ ok: false, value: 109 });
  });
});