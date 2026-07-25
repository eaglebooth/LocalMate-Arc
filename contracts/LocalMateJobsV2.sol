// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20V2 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @title LocalMateJobsV2
/// @notice Funded neighborhood job board escrow for Arc.
/// @dev Applications remain offchain. The selected applicant is assigned onchain after funding.
contract LocalMateJobsV2 {
    enum Status {
        Open,
        Funded,
        Assigned,
        Submitted,
        Completed,
        Rejected,
        Cancelled,
        Expired
    }

    struct Job {
        address client;
        address provider;
        address evaluator;
        uint128 budget;
        uint64 expiresAt;
        Status status;
        bytes32 requirementsHash;
        bytes32 applicationHash;
        bytes32 deliverableHash;
    }

    IERC20V2 public immutable paymentToken;
    address public immutable treasury;
    uint16 public immutable feeBps;
    uint256 public nextJobId = 1;
    uint256 private unlocked = 1;
    mapping(uint256 => Job) public jobs;

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed evaluator,
        uint256 budget,
        uint256 expiresAt,
        bytes32 requirementsHash
    );
    event JobFunded(uint256 indexed jobId, uint256 amount);
    event ProviderAssigned(
        uint256 indexed jobId,
        address indexed provider,
        bytes32 indexed applicationHash
    );
    event WorkSubmitted(uint256 indexed jobId, bytes32 indexed deliverableHash);
    event JobCompleted(uint256 indexed jobId, uint256 providerPayment, uint256 fee);
    event JobRejected(uint256 indexed jobId, bytes32 indexed reasonHash);
    event JobCancelled(uint256 indexed jobId);
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
        if (
            usdc == address(0) ||
            usdc.code.length == 0 ||
            platformTreasury == address(0) ||
            platformFeeBps > 1_000
        ) {
            revert InvalidInput();
        }
        paymentToken = IERC20V2(usdc);
        treasury = platformTreasury;
        feeBps = platformFeeBps;
    }

    function createJob(
        address evaluator,
        uint128 budget,
        uint64 expiresAt,
        bytes32 requirementsHash
    ) external returns (uint256 jobId) {
        if (
            evaluator == address(0) ||
            budget == 0 ||
            expiresAt <= block.timestamp ||
            requirementsHash == bytes32(0)
        ) revert InvalidInput();

        jobId = nextJobId++;
        jobs[jobId] = Job({
            client: msg.sender,
            provider: address(0),
            evaluator: evaluator,
            budget: budget,
            expiresAt: expiresAt,
            status: Status.Open,
            requirementsHash: requirementsHash,
            applicationHash: bytes32(0),
            deliverableHash: bytes32(0)
        });

        emit JobCreated(jobId, msg.sender, evaluator, budget, expiresAt, requirementsHash);
    }

    function fund(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert Unauthorized();
        if (job.status != Status.Open || block.timestamp >= job.expiresAt) revert InvalidState();

        job.status = Status.Funded;
        _safeTransferFrom(msg.sender, address(this), job.budget);
        emit JobFunded(jobId, job.budget);
    }

    function assignProvider(
        uint256 jobId,
        address provider,
        bytes32 applicationHash
    ) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert Unauthorized();
        if (
            job.status != Status.Funded ||
            block.timestamp >= job.expiresAt ||
            provider == address(0) ||
            applicationHash == bytes32(0)
        ) revert InvalidState();

        job.provider = provider;
        job.applicationHash = applicationHash;
        job.status = Status.Assigned;
        emit ProviderAssigned(jobId, provider, applicationHash);
    }

    function submit(uint256 jobId, bytes32 deliverableHash) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.provider) revert Unauthorized();
        if (
            job.status != Status.Assigned ||
            block.timestamp >= job.expiresAt ||
            deliverableHash == bytes32(0)
        ) revert InvalidState();

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
        _safeTransfer(job.provider, providerPayment);
        if (fee != 0) _safeTransfer(treasury, fee);
        emit JobCompleted(jobId, providerPayment, fee);
    }

    function reject(uint256 jobId, bytes32 reasonHash) external nonReentrant {
        Job storage job = jobs[jobId];
        if (msg.sender != job.evaluator) revert Unauthorized();
        if (
            (job.status != Status.Assigned && job.status != Status.Submitted) ||
            reasonHash == bytes32(0)
        ) revert InvalidState();

        job.status = Status.Rejected;
        _safeTransfer(job.client, job.budget);
        emit JobRejected(jobId, reasonHash);
    }

    function cancelUnassigned(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert Unauthorized();
        if (job.status != Status.Funded || job.provider != address(0)) revert InvalidState();

        job.status = Status.Cancelled;
        _safeTransfer(job.client, job.budget);
        emit JobCancelled(jobId);
    }

    function claimRefund(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (block.timestamp < job.expiresAt) revert InvalidState();
        if (job.status != Status.Funded && job.status != Status.Assigned) revert InvalidState();

        job.status = Status.Expired;
        _safeTransfer(job.client, job.budget);
        emit JobExpired(jobId);
    }

    function _safeTransfer(address to, uint256 amount) private {
        (bool success, bytes memory data) = address(paymentToken).call(
            abi.encodeCall(IERC20V2.transfer, (to, amount))
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address from, address to, uint256 amount) private {
        (bool success, bytes memory data) = address(paymentToken).call(
            abi.encodeCall(IERC20V2.transferFrom, (from, to, amount))
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
