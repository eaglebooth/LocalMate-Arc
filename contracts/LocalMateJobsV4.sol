// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20V4 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}

/// @title LocalMateJobsV4
/// @notice Arc USDC escrow supporting EOA and Circle smart-account applicants.
contract LocalMateJobsV4 {
    enum Status { Open, Funded, Assigned, Submitted, Disputed, Completed, Rejected, Cancelled, Expired }

    struct Job {
        address client;
        address provider;
        address evaluator;
        uint128 budget;
        uint64 workDeadline;
        uint64 submittedAt;
        Status status;
        bytes32 requirementsHash;
        bytes32 applicationHash;
        bytes32 evidenceHash;
        bytes32 evidenceUriHash;
        bytes32 disputeHash;
    }

    IERC20V4 public immutable paymentToken;
    address public immutable treasury;
    uint16 public immutable feeBps;
    uint64 public immutable reviewPeriod;
    uint256 public nextJobId = 1;
    uint256 private unlocked = 1;
    mapping(uint256 => Job) public jobs;

    event JobCreated(uint256 indexed jobId, address indexed client, address indexed evaluator, uint256 budget, uint256 workDeadline, bytes32 requirementsHash);
    event JobFunded(uint256 indexed jobId, uint256 amount);
    event ProviderAssigned(uint256 indexed jobId, address indexed provider, bytes32 indexed applicationHash);
    event EvidenceSubmitted(uint256 indexed jobId, bytes32 indexed evidenceHash, bytes32 indexed evidenceUriHash, uint256 reviewDeadline);
    event JobCompleted(uint256 indexed jobId, uint256 providerPayment, uint256 fee, bool automatic);
    event JobRejected(uint256 indexed jobId, bytes32 indexed reasonHash);
    event DisputeRaised(uint256 indexed jobId, address indexed raisedBy, bytes32 indexed reasonHash);
    event DisputeResolved(uint256 indexed jobId, uint256 providerPayment, uint256 clientRefund, uint256 fee);
    event JobCancelled(uint256 indexed jobId);
    event JobExpired(uint256 indexed jobId);

    error Unauthorized();
    error InvalidState();
    error InvalidInput();
    error InvalidSignature();
    error TransferFailed();

    modifier nonReentrant() {
        if (unlocked != 1) revert InvalidState();
        unlocked = 2;
        _;
        unlocked = 1;
    }

    constructor(address usdc, address platformTreasury, uint16 platformFeeBps, uint64 evidenceReviewPeriod) {
        if (usdc == address(0) || usdc.code.length == 0 || platformTreasury == address(0) || platformFeeBps > 1_000 || evidenceReviewPeriod < 60 || evidenceReviewPeriod > 30 days) revert InvalidInput();
        paymentToken = IERC20V4(usdc);
        treasury = platformTreasury;
        feeBps = platformFeeBps;
        reviewPeriod = evidenceReviewPeriod;
    }

    function createJob(address evaluator, uint128 budget, uint64 workDeadline, bytes32 requirementsHash) external returns (uint256 jobId) {
        if (evaluator == address(0) || budget == 0 || workDeadline <= block.timestamp || requirementsHash == bytes32(0)) revert InvalidInput();
        jobId = nextJobId++;
        jobs[jobId] = Job(msg.sender, address(0), evaluator, budget, workDeadline, 0, Status.Open, requirementsHash, bytes32(0), bytes32(0), bytes32(0), bytes32(0));
        emit JobCreated(jobId, msg.sender, evaluator, budget, workDeadline, requirementsHash);
    }

    function fund(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert Unauthorized();
        if (job.status != Status.Open || block.timestamp >= job.workDeadline) revert InvalidState();
        job.status = Status.Funded;
        _safeTransferFrom(msg.sender, address(this), job.budget);
        emit JobFunded(jobId, job.budget);
    }

    function applicationDigest(uint256 jobId, address provider) public view returns (bytes32) {
        Job storage job = jobs[jobId];
        return keccak256(abi.encode(address(this), block.chainid, jobId, provider, job.requirementsHash, job.budget, job.workDeadline));
    }

    function assignProvider(uint256 jobId, address provider, bytes calldata providerSignature) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert Unauthorized();
        if (job.status != Status.Funded || block.timestamp >= job.workDeadline || provider == address(0)) revert InvalidState();
        if (!_isValidProviderSignature(applicationDigest(jobId, provider), provider, providerSignature)) revert InvalidSignature();
        job.provider = provider;
        job.applicationHash = keccak256(providerSignature);
        job.status = Status.Assigned;
        emit ProviderAssigned(jobId, provider, job.applicationHash);
    }

    function submitEvidence(uint256 jobId, bytes32 evidenceHash, bytes32 evidenceUriHash) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.provider) revert Unauthorized();
        if (job.status != Status.Assigned || block.timestamp >= job.workDeadline || evidenceHash == bytes32(0) || evidenceUriHash == bytes32(0)) revert InvalidState();
        job.evidenceHash = evidenceHash;
        job.evidenceUriHash = evidenceUriHash;
        job.submittedAt = uint64(block.timestamp);
        job.status = Status.Submitted;
        emit EvidenceSubmitted(jobId, evidenceHash, evidenceUriHash, block.timestamp + reviewPeriod);
    }

    function complete(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (msg.sender != job.evaluator) revert Unauthorized();
        if (job.status != Status.Submitted) revert InvalidState();
        _payProvider(jobId, job, false);
    }

    function autoRelease(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.status != Status.Submitted || block.timestamp < uint256(job.submittedAt) + reviewPeriod) revert InvalidState();
        _payProvider(jobId, job, true);
    }

    function reject(uint256 jobId, bytes32 reasonHash) external nonReentrant {
        Job storage job = jobs[jobId];
        if (msg.sender != job.evaluator) revert Unauthorized();
        if ((job.status != Status.Assigned && job.status != Status.Submitted) || reasonHash == bytes32(0)) revert InvalidState();
        job.status = Status.Rejected;
        _safeTransfer(job.client, job.budget);
        emit JobRejected(jobId, reasonHash);
    }

    function raiseDispute(uint256 jobId, bytes32 reasonHash) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client && msg.sender != job.provider) revert Unauthorized();
        if ((job.status != Status.Assigned && job.status != Status.Submitted) || reasonHash == bytes32(0)) revert InvalidState();
        job.disputeHash = reasonHash;
        job.status = Status.Disputed;
        emit DisputeRaised(jobId, msg.sender, reasonHash);
    }

    function resolveDispute(uint256 jobId, uint16 providerShareBps) external nonReentrant {
        Job storage job = jobs[jobId];
        if (msg.sender != job.evaluator) revert Unauthorized();
        if (job.status != Status.Disputed || providerShareBps > 10_000) revert InvalidState();
        job.status = Status.Completed;
        uint256 providerGross = uint256(job.budget) * providerShareBps / 10_000;
        uint256 clientRefund = uint256(job.budget) - providerGross;
        uint256 fee = providerGross * feeBps / 10_000;
        uint256 providerPayment = providerGross - fee;
        if (providerPayment != 0) _safeTransfer(job.provider, providerPayment);
        if (fee != 0) _safeTransfer(treasury, fee);
        if (clientRefund != 0) _safeTransfer(job.client, clientRefund);
        emit DisputeResolved(jobId, providerPayment, clientRefund, fee);
    }

    function cancelUnassigned(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert Unauthorized();
        if (job.status != Status.Funded || job.provider != address(0)) revert InvalidState();
        job.status = Status.Cancelled;
        _safeTransfer(job.client, job.budget);
        emit JobCancelled(jobId);
    }

    function claimExpired(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (block.timestamp < job.workDeadline) revert InvalidState();
        if (job.status != Status.Funded && job.status != Status.Assigned) revert InvalidState();
        job.status = Status.Expired;
        _safeTransfer(job.client, job.budget);
        emit JobExpired(jobId);
    }

    function _isValidProviderSignature(bytes32 digest, address provider, bytes calldata signature) private view returns (bool) {
        bytes32 signedDigest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        if (provider.code.length != 0) {
            (bool success, bytes memory result) = provider.staticcall(
                abi.encodeCall(IERC1271.isValidSignature, (signedDigest, signature))
            );
            return success && result.length >= 32 && abi.decode(result, (bytes4)) == IERC1271.isValidSignature.selector;
        }
        return _recover(signedDigest, signature) == provider;
    }

    function _recover(bytes32 signedDigest, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0) return address(0);
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        signer = ecrecover(signedDigest, v, r, s);
    }

    function _payProvider(uint256 jobId, Job storage job, bool automatic) private {
        job.status = Status.Completed;
        uint256 fee = uint256(job.budget) * feeBps / 10_000;
        uint256 providerPayment = uint256(job.budget) - fee;
        _safeTransfer(job.provider, providerPayment);
        if (fee != 0) _safeTransfer(treasury, fee);
        emit JobCompleted(jobId, providerPayment, fee, automatic);
    }

    function _safeTransfer(address to, uint256 amount) private {
        (bool success, bytes memory data) = address(paymentToken).call(abi.encodeCall(IERC20V4.transfer, (to, amount)));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address from, address to, uint256 amount) private {
        (bool success, bytes memory data) = address(paymentToken).call(abi.encodeCall(IERC20V4.transferFrom, (from, to, amount)));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
