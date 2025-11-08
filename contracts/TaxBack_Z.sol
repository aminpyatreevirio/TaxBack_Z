pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract TaxRefundCalculator is ZamaEthereumConfig {
    struct Receipt {
        euint32 encryptedAmount;
        uint256 category;
        uint256 timestamp;
        address owner;
        uint32 decryptedAmount;
        bool isVerified;
    }

    mapping(string => Receipt) public receipts;
    string[] public receiptIds;

    event ReceiptCreated(string indexed receiptId, address indexed owner);
    event DecryptionVerified(string indexed receiptId, uint32 decryptedAmount);

    constructor() ZamaEthereumConfig() {}

    function createReceipt(
        string calldata receiptId,
        externalEuint32 encryptedAmount,
        bytes calldata inputProof,
        uint256 category
    ) external {
        require(bytes(receipts[receiptId].owner).length == 0, "Receipt already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedAmount, inputProof)), "Invalid encrypted input");

        receipts[receiptId] = Receipt({
            encryptedAmount: FHE.fromExternal(encryptedAmount, inputProof),
            category: category,
            timestamp: block.timestamp,
            owner: msg.sender,
            decryptedAmount: 0,
            isVerified: false
        });

        FHE.allowThis(receipts[receiptId].encryptedAmount);
        FHE.makePubliclyDecryptable(receipts[receiptId].encryptedAmount);
        receiptIds.push(receiptId);

        emit ReceiptCreated(receiptId, msg.sender);
    }

    function verifyDecryption(
        string calldata receiptId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(receipts[receiptId].owner).length > 0, "Receipt does not exist");
        require(!receipts[receiptId].isVerified, "Data already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(receipts[receiptId].encryptedAmount);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));

        receipts[receiptId].decryptedAmount = decodedValue;
        receipts[receiptId].isVerified = true;

        emit DecryptionVerified(receiptId, decodedValue);
    }

    function calculateRefund(string calldata receiptId, uint32 taxRate) external view returns (euint32) {
        require(bytes(receipts[receiptId].owner).length > 0, "Receipt does not exist");
        euint32 memory encryptedAmount = receipts[receiptId].encryptedAmount;
        euint32 memory encryptedRefund = FHE.mul(encryptedAmount, FHE.euint32(taxRate));
        return FHE.div(encryptedRefund, FHE.euint32(100));
    }

    function getReceipt(string calldata receiptId) external view returns (
        uint256 category,
        uint256 timestamp,
        address owner,
        bool isVerified,
        uint32 decryptedAmount
    ) {
        require(bytes(receipts[receiptId].owner).length > 0, "Receipt does not exist");
        Receipt storage r = receipts[receiptId];
        return (r.category, r.timestamp, r.owner, r.isVerified, r.decryptedAmount);
    }

    function getAllReceiptIds() external view returns (string[] memory) {
        return receiptIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

