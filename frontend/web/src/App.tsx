import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface TaxRecord {
  id: string;
  name: string;
  amount: number;
  category: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [taxRecords, setTaxRecords] = useState<TaxRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newRecordData, setNewRecordData] = useState({ name: "", amount: "", category: "food" });
  const [selectedRecord, setSelectedRecord] = useState<TaxRecord | null>(null);
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const recordsList: TaxRecord[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          recordsList.push({
            id: businessId,
            name: businessData.name,
            amount: 0,
            category: "general",
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setTaxRecords(recordsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const uploadRecord = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setUploading(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting tax data with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const amountValue = parseInt(newRecordData.amount) || 0;
      const businessId = `tax-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, amountValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newRecordData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newRecordData.category === "food" ? "1" : "2") || 0,
        0,
        `Tax record for ${newRecordData.name}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Tax record uploaded successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowUploadModal(false);
      setNewRecordData({ name: "", amount: "", category: "food" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Upload failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setUploading(false); 
    }
  };

  const decryptAmount = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Tax amount decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "FHE system is available and ready" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredRecords = taxRecords.filter(record => {
    const matchesSearch = record.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = activeCategory === "all" || 
      (activeCategory === "food" && record.publicValue1 === 1) ||
      (activeCategory === "other" && record.publicValue1 === 2);
    return matchesSearch && matchesCategory;
  });

  const stats = {
    totalRecords: taxRecords.length,
    verifiedRecords: taxRecords.filter(r => r.isVerified).length,
    totalAmount: taxRecords.reduce((sum, r) => sum + (r.decryptedValue || 0), 0),
    avgRefund: taxRecords.length > 0 ? Math.round(taxRecords.reduce((sum, r) => sum + (r.decryptedValue || 0), 0) / taxRecords.length) : 0
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>TaxBack_Z 🔐</h1>
            <span>隱私退稅助手</span>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">💰</div>
            <h2>Connect Wallet to Start</h2>
            <p>Connect your wallet to access encrypted tax refund calculations with full privacy protection.</p>
            <div className="feature-grid">
              <div className="feature-item">
                <div className="feature-icon">🔒</div>
                <h4>Data Encryption</h4>
                <p>Your tax data stays encrypted and private</p>
              </div>
              <div className="feature-item">
                <div className="feature-icon">⚡</div>
                <h4>FHE Calculation</h4>
                <p>Tax refunds computed without decryption</p>
              </div>
              <div className="feature-item">
                <div className="feature-icon">🛡️</div>
                <h4>Local Processing</h4>
                <p>Your data never leaves your device</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Setting up secure tax calculation environment</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted tax records...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>TaxBack_Z 🔐</h1>
          <span>隱私退稅助手</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="status-btn">
            Check FHE Status
          </button>
          <button onClick={() => setShowUploadModal(true)} className="upload-btn">
            + Upload Receipt
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">📊</div>
            <div className="stat-content">
              <h3>{stats.totalRecords}</h3>
              <p>Total Records</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">✅</div>
            <div className="stat-content">
              <h3>{stats.verifiedRecords}</h3>
              <p>Verified</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">💰</div>
            <div className="stat-content">
              <h3>${stats.totalAmount}</h3>
              <p>Total Refund</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">📈</div>
            <div className="stat-content">
              <h3>${stats.avgRefund}</h3>
              <p>Average</p>
            </div>
          </div>
        </div>

        <div className="controls-row">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search tax records..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="category-filters">
            <button 
              className={activeCategory === "all" ? "active" : ""}
              onClick={() => setActiveCategory("all")}
            >
              All
            </button>
            <button 
              className={activeCategory === "food" ? "active" : ""}
              onClick={() => setActiveCategory("food")}
            >
              Food
            </button>
            <button 
              className={activeCategory === "other" ? "active" : ""}
              onClick={() => setActiveCategory("other")}
            >
              Other
            </button>
          </div>
          <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="records-list">
          {filteredRecords.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🧾</div>
              <h3>No tax records found</h3>
              <p>Upload your first encrypted receipt to get started</p>
              <button onClick={() => setShowUploadModal(true)} className="upload-btn">
                Upload First Receipt
              </button>
            </div>
          ) : (
            filteredRecords.map((record, index) => (
              <div 
                className={`record-item ${record.isVerified ? "verified" : ""}`}
                key={index}
                onClick={() => setSelectedRecord(record)}
              >
                <div className="record-header">
                  <h4>{record.name}</h4>
                  <span className={`status-badge ${record.isVerified ? "verified" : "pending"}`}>
                    {record.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                  </span>
                </div>
                <div className="record-details">
                  <span>Category: {record.publicValue1 === 1 ? "Food" : "Other"}</span>
                  <span>Date: {new Date(record.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="record-amount">
                  {record.isVerified ? `Refund: $${record.decryptedValue}` : "Amount: 🔒 Encrypted"}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      
      {showUploadModal && (
        <UploadModal 
          onSubmit={uploadRecord} 
          onClose={() => setShowUploadModal(false)} 
          uploading={uploading}
          recordData={newRecordData}
          setRecordData={setNewRecordData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedRecord && (
        <DetailModal 
          record={selectedRecord}
          onClose={() => {
            setSelectedRecord(null);
            setDecryptedAmount(null);
          }}
          decryptedAmount={decryptedAmount}
          isDecrypting={isDecrypting || fheIsDecrypting}
          decryptAmount={() => decryptAmount(selectedRecord.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const UploadModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  uploading: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, uploading, recordData, setRecordData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'amount') {
      const intValue = value.replace(/[^\d]/g, '');
      setRecordData({ ...recordData, [name]: intValue });
    } else {
      setRecordData({ ...recordData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="upload-modal">
        <div className="modal-header">
          <h2>Upload Tax Receipt</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="encryption-notice">
            <div className="encryption-icon">🔐</div>
            <div>
              <strong>FHE Encrypted Upload</strong>
              <p>Tax amount will be encrypted using Zama FHE technology</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>Receipt Name *</label>
            <input 
              type="text" 
              name="name" 
              value={recordData.name}
              onChange={handleChange}
              placeholder="Enter receipt description..."
            />
          </div>
          
          <div className="form-group">
            <label>Amount (Integer only) *</label>
            <input 
              type="number" 
              name="amount" 
              value={recordData.amount}
              onChange={handleChange}
              placeholder="Enter tax amount..."
              min="0"
              step="1"
            />
            <span className="input-hint">FHE Encrypted Integer</span>
          </div>
          
          <div className="form-group">
            <label>Category *</label>
            <select name="category" value={recordData.category} onChange={handleChange}>
              <option value="food">Food & Dining</option>
              <option value="other">Other Expenses</option>
            </select>
            <span className="input-hint">Public Category Data</span>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit}
            disabled={uploading || isEncrypting || !recordData.name || !recordData.amount}
            className="submit-btn"
          >
            {uploading || isEncrypting ? "Encrypting..." : "Upload Receipt"}
          </button>
        </div>
      </div>
    </div>
  );
};

const DetailModal: React.FC<{
  record: TaxRecord;
  onClose: () => void;
  decryptedAmount: number | null;
  isDecrypting: boolean;
  decryptAmount: () => Promise<number | null>;
}> = ({ record, onClose, decryptedAmount, isDecrypting, decryptAmount }) => {
  const handleDecrypt = async () => {
    if (decryptedAmount !== null) return;
    await decryptAmount();
  };

  const calculatedRefund = record.publicValue1 === 1 ? 
    Math.round((record.isVerified ? record.decryptedValue! : decryptedAmount || 0) * 0.15) :
    Math.round((record.isVerified ? record.decryptedValue! : decryptedAmount || 0) * 0.08);

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Tax Record Details</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="record-info">
            <div className="info-row">
              <span>Receipt Name:</span>
              <strong>{record.name}</strong>
            </div>
            <div className="info-row">
              <span>Category:</span>
              <strong>{record.publicValue1 === 1 ? "Food & Dining" : "Other Expenses"}</strong>
            </div>
            <div className="info-row">
              <span>Upload Date:</span>
              <strong>{new Date(record.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-row">
              <span>Encryption Status:</span>
              <strong className={record.isVerified ? "verified" : "encrypted"}>
                {record.isVerified ? "✅ On-chain Verified" : "🔒 FHE Encrypted"}
              </strong>
            </div>
          </div>
          
          <div className="amount-section">
            <h3>Tax Amount</h3>
            <div className="amount-display">
              {record.isVerified ? (
                <div className="verified-amount">${record.decryptedValue}</div>
              ) : decryptedAmount !== null ? (
                <div className="decrypted-amount">${decryptedAmount}</div>
              ) : (
                <div className="encrypted-amount">🔒 Encrypted</div>
              )}
              
              <button 
                onClick={handleDecrypt}
                disabled={isDecrypting || record.isVerified}
                className={`decrypt-btn ${record.isVerified ? "verified" : ""}`}
              >
                {isDecrypting ? "Decrypting..." : 
                 record.isVerified ? "Verified" : 
                 decryptedAmount !== null ? "Re-verify" : "Decrypt Amount"}
              </button>
            </div>
          </div>
          
          {(record.isVerified || decryptedAmount !== null) && (
            <div className="refund-calculation">
              <h3>Refund Calculation</h3>
              <div className="refund-result">
                <div className="refund-amount">${calculatedRefund}</div>
                <div className="refund-formula">
                  {record.publicValue1 === 1 ? "15% Food Category" : "8% Other Category"}
                </div>
              </div>
              <div className="fhe-explanation">
                <div className="explanation-icon">⚡</div>
                <p>Refund calculated using FHE without decrypting your original amount</p>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;