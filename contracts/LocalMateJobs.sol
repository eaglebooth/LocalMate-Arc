// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @title LocalMateJobs
/// @notice Minimal ERC-8183-inspired escrow for neighborhood service jobs on Arc.
/// Private task details and evidence stay offchain; only their hashes are recorded.
contract LocalMateJobs {
    enum Status { Open, Funded, Submitted, Completed, Rejected, Expired }

    struct Job {
        address client;
        address provider;
        address evaluator;
        uint128 budget;
        uint64 expiresAt;
        Status status;
        bytes32 requirementsHash;
        bytes32 deliverableHash;
    }

    IERC20 public immutable paymentToken;
    address public immutable treasury;
    uint16 public immutable feeBps;
    uint256 public nextJobId = 1;
    uint256 private unlocked = 1;
    mapping(uint256 => Job) public jobs;

    event JobCreated(uint256 indexed jobId, address indexed client, address provider, address evaluator);
    event JobFunded(uint256 indexed jobId, uint256 amount);
    event ProviderAssigned(uint256 indexed jobId, address indexed provider);
    event WorkSubmitted(uint256 indexed jobId, bytes32 indexed deliverableHash);
    event JobCompleted(uint256 indexed jobId, uint256 providerPayment, uint256 fee);
    event JobRejected(uint256 indexed jobId, bytes32 indexed reasonHash);
    event JobExpired(uint256 indexed jobId);

    error Unauthorized();
    error InvalidState();
    error InvalidInput();
    error TransferFailed();

    modifier nonReentrant() {
        if (unlocked != 1) revert InvalidState();
        unlocked = 2;
        _;
        unlocked = 1;
    }

    constructor(address usdc, address platformTreasury, uint16 platformFeeBps) {
        if (usdc == address(0) || platformTreasury == address(0) || platformFeeBps > 1_000) {
            revert InvalidInput();
        }
        paymentToken = IERC20(usdc);
        treasury = platformTreasury;
        feeBps = platformFeeBps;
    }

    function createJob(
        address provider,
        address evaluator,
        uint128 budget,
        uint64 expiresAt,
        bytes32 requirementsHash
    ) external returns (uint256 jobId) {
        if (evaluator == address(0) || budget == 0 || expiresAt <= block.timestamp) revert InvalidInput();
        jobId = nextJobId++;
        jobs[jobId] = Job({
            client: msg.sender,
            provider: provider,
            evaluator: evaluator,
            budget: budget,
            expiresAt: expiresAt,
            status: Status.Open,
            requirementsHash: requirementsHash,
            deliverableHash: bytes32(0)
        });
        emit JobCreated(jobId, msg.sender, provider, evaluator);
    }

    function assignProvider(uint256 jobId, address provider) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert Unauthorized();
        if (job.status != Status.Open || job.provider != address(0) || provider == address(0)) revert InvalidState();
        job.provider = provider;
        emit ProviderAssigned(jobId, provider);
    }

    function fund(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert Unauthorized();
        if (job.status != Status.Open || job.provider == address(0)) revert InvalidState();
        job.status = Status.Funded;
        if (!paymentToken.transferFrom(msg.sender, address(this), job.budget)) revert TransferFailed();
        emit JobFunded(jobId, job.budget);
    }

    function submit(uint256 jobId, bytes32 deliverableHash) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.provider) revert Unauthorized();
        if (job.status != Status.Funded || deliverableHash == bytes32(0)) revert InvalidState();
        job.deliverableHash = deliverableHash;
        job.status = Status.Submitted;
        emit WorkSubmitted(jobId, deliverableHash);
    }

    function complete(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (msg.sender != job.evaluator) revert Unauthorized();
        if (job.status != Status.Submitted) revert InvalidState();
        job.status = Status.Completed;
        uint256 fee = uint256(job.budget) * feeBps / 10_000;
        uint256 providerPayment = uint256(job.budget) - fee;
        if (!paymentToken.transfer(job.provider, providerPayment)) revert TransferFailed();
        if (fee != 0 && !paymentToken.transfer(treasury, fee)) revert TransferFailed();
        emit JobCompleted(jobId, providerPayment, fee);
    }

    function reject(uint256 jobId, bytes32 reasonHash) external nonReentrant {
        Job storage job = jobs[jobId];
        if (msg.sender != job.evaluator) revert Unauthorized();
        if (job.status != Status.Funded && job.status != Status.Submitted) revert InvalidState();
        job.status = Status.Rejected;
        if (!paymentToken.transfer(job.client, job.budget)) revert TransferFailed();
        emit JobRejected(jobId, reasonHash);
    }

    function claimRefund(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (block.timestamp < job.expiresAt) revert InvalidState();
        if (job.status != Status.Funded && job.status != Status.Submitted) revert InvalidState();
        job.status = Status.Expired;
        if (!paymentToken.transfer(job.client, job.budget)) revert TransferFailed();
        emit JobExpired(jobId);
    }
}
