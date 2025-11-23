import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { JSX, useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface TaxRefundData {
  id: number;
  name: string;
  encryptedAmount: string;
  taxRate: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface RefundAnalysis {
  refundAmount: number;
  taxSavings: number;
  efficiency: number;
  processingTime: number;
  confidence: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [refunds, setRefunds] = useState<TaxRefundData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingRefund, setCreatingRefund] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newRefundData, setNewRefundData] = useState({ name: "", amount: "", taxRate: "" });
  const [selectedRefund, setSelectedRefund] = useState<TaxRefundData | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ amount: number | null; taxRate: number | null }>({ amount: null, taxRate: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) {
        return;
      }
      
      if (isInitialized) {
        return;
      }
      
      if (fhevmInitializing) {
        return;
      }
      
      try {
        setFhevmInitializing(true);
        console.log('Initializing FHEVM after wallet connection...');
        await initialize();
        console.log('FHEVM initialized successfully');
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed. Please check your wallet connection." 
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
      const refundsList: TaxRefundData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          refundsList.push({
            id: parseInt(businessId.replace('refund-', '')) || Date.now(),
            name: businessData.name,
            encryptedAmount: businessId,
            taxRate: businessId,
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
      
      setRefunds(refundsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createRefund = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingRefund(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating tax refund with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const amountValue = parseInt(newRefundData.amount) || 0;
      const businessId = `refund-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, amountValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newRefundData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newRefundData.taxRate) || 0,
        0,
        "Tax Refund Claim"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Tax refund created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewRefundData({ name: "", amount: "", taxRate: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingRefund(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
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
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
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

  const analyzeRefund = (refund: TaxRefundData, decryptedAmount: number | null, decryptedTaxRate: number | null): RefundAnalysis => {
    const amount = refund.isVerified ? (refund.decryptedValue || 0) : (decryptedAmount || refund.publicValue1 || 100);
    const taxRate = refund.publicValue1 || 10;
    
    const refundAmount = Math.round(amount * (taxRate / 100));
    const taxSavings = Math.round(refundAmount * 0.3);
    const efficiency = Math.min(100, Math.round((amount / 1000) * 100));
    const processingTime = Math.max(1, Math.round(10 - (amount / 1000)));
    const confidence = Math.min(95, Math.round((amount / 500) * 100));

    return {
      refundAmount,
      taxSavings,
      efficiency,
      processingTime,
      confidence
    };
  };

  const renderDashboard = () => {
    const totalClaims = refunds.length;
    const verifiedClaims = refunds.filter(m => m.isVerified).length;
    const avgRefund = refunds.length > 0 
      ? refunds.reduce((sum, m) => sum + (m.decryptedValue || 0), 0) / refunds.length 
      : 0;
    
    const recentClaims = refunds.filter(m => 
      Date.now()/1000 - m.timestamp < 60 * 60 * 24 * 7
    ).length;

    return (
      <div className="dashboard-panels">
        <div className="panel metal-panel">
          <h3>Total Claims</h3>
          <div className="stat-value">{totalClaims}</div>
          <div className="stat-trend">+{recentClaims} this week</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>Verified Data</h3>
          <div className="stat-value">{verifiedClaims}/{totalClaims}</div>
          <div className="stat-trend">FHE Verified</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>Avg Refund</h3>
          <div className="stat-value">${avgRefund.toFixed(0)}</div>
          <div className="stat-trend">Secure Processing</div>
        </div>
      </div>
    );
  };

  const renderAnalysisChart = (refund: TaxRefundData, decryptedAmount: number | null, decryptedTaxRate: number | null) => {
    const analysis = analyzeRefund(refund, decryptedAmount, decryptedTaxRate);
    
    return (
      <div className="analysis-chart">
        <div className="chart-row">
          <div className="chart-label">Refund Amount</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${Math.min(100, analysis.refundAmount/10)}%` }}
            >
              <span className="bar-value">${analysis.refundAmount}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Tax Savings</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${Math.min(100, analysis.taxSavings/5)}%` }}
            >
              <span className="bar-value">${analysis.taxSavings}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Efficiency</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.efficiency}%` }}
            >
              <span className="bar-value">{analysis.efficiency}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Processing Time</div>
          <div className="chart-bar">
            <div 
              className="bar-fill risk" 
              style={{ width: `${100 - analysis.processingTime * 10}%` }}
            >
              <span className="bar-value">{analysis.processingTime} days</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Confidence</div>
          <div className="chart-bar">
            <div 
              className="bar-fill growth" 
              style={{ width: `${analysis.confidence}%` }}
            >
              <span className="bar-value">{analysis.confidence}%</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <h4>Receipt Upload</h4>
            <p>Tax receipt data encrypted with Zama FHE 🔐</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <h4>FHE Computation</h4>
            <p>Homomorphic calculation of refund amount</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <h4>Local Decryption</h4>
            <p>Client performs secure offline decryption</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">4</div>
          <div className="step-content">
            <h4>On-chain Verification</h4>
            <p>FHE signature verification for audit trail</p>
          </div>
        </div>
      </div>
    );
  };

  const filteredRefunds = refunds.filter(refund => 
    refund.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    refund.creator.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>TaxBack_Z 🔐</h1>
            <span>Privacy-Preserving Tax Refunds</span>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to initialize the encrypted tax refund system and access secure refund processing.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet using the button above</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will automatically initialize</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start processing encrypted tax refunds securely</p>
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
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
        <p className="loading-note">This may take a few moments</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted tax system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>TaxBack_Z 🔐</h1>
          <span>FHE-Powered Tax Refunds</span>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Refund Claim
          </button>
          <button 
            onClick={() => setShowFAQ(!showFAQ)} 
            className="faq-btn"
          >
            FAQ
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Private Tax Refund Analytics (FHE 🔐)</h2>
          {renderDashboard()}
          
          <div className="panel metal-panel full-width">
            <h3>FHE 🔐 Privacy-Preserving Flow</h3>
            {renderFHEFlow()}
          </div>
        </div>
        
        <div className="refunds-section">
          <div className="section-header">
            <h2>Tax Refund Claims</h2>
            <div className="header-actions">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search claims..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="refunds-list">
            {filteredRefunds.length === 0 ? (
              <div className="no-refunds">
                <p>No tax refund claims found</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Claim
                </button>
              </div>
            ) : filteredRefunds.map((refund, index) => (
              <div 
                className={`refund-item ${selectedRefund?.id === refund.id ? "selected" : ""} ${refund.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedRefund(refund)}
              >
                <div className="refund-title">{refund.name}</div>
                <div className="refund-meta">
                  <span>Tax Rate: {refund.publicValue1}%</span>
                  <span>Created: {new Date(refund.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="refund-status">
                  Status: {refund.isVerified ? "✅ On-chain Verified" : "🔓 Ready for Verification"}
                  {refund.isVerified && refund.decryptedValue && (
                    <span className="verified-amount">Amount: ${refund.decryptedValue}</span>
                  )}
                </div>
                <div className="refund-creator">Creator: {refund.creator.substring(0, 6)}...{refund.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateRefund 
          onSubmit={createRefund} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingRefund} 
          refundData={newRefundData} 
          setRefundData={setNewRefundData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedRefund && (
        <RefundDetailModal 
          refund={selectedRefund} 
          onClose={() => { 
            setSelectedRefund(null); 
            setDecryptedData({ amount: null, taxRate: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedRefund.encryptedAmount)}
          renderAnalysisChart={renderAnalysisChart}
        />
      )}
      
      {showFAQ && (
        <FAQModal onClose={() => setShowFAQ(false)} />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateRefund: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  refundData: any;
  setRefundData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, refundData, setRefundData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'amount') {
      const intValue = value.replace(/[^\d]/g, '');
      setRefundData({ ...refundData, [name]: intValue });
    } else {
      setRefundData({ ...refundData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-refund-modal">
        <div className="modal-header">
          <h2>New Tax Refund Claim</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Receipt amount will be encrypted with Zama FHE 🔐 (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Receipt Description *</label>
            <input 
              type="text" 
              name="name" 
              value={refundData.name} 
              onChange={handleChange} 
              placeholder="Enter receipt description..." 
            />
          </div>
          
          <div className="form-group">
            <label>Amount (Integer only) *</label>
            <input 
              type="number" 
              name="amount" 
              value={refundData.amount} 
              onChange={handleChange} 
              placeholder="Enter amount..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Tax Rate (%) *</label>
            <input 
              type="number" 
              min="1" 
              max="50" 
              name="taxRate" 
              value={refundData.taxRate} 
              onChange={handleChange} 
              placeholder="Enter tax rate..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !refundData.name || !refundData.amount || !refundData.taxRate} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Claim"}
          </button>
        </div>
      </div>
    </div>
  );
};

const RefundDetailModal: React.FC<{
  refund: TaxRefundData;
  onClose: () => void;
  decryptedData: { amount: number | null; taxRate: number | null };
  setDecryptedData: (value: { amount: number | null; taxRate: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderAnalysisChart: (refund: TaxRefundData, decryptedAmount: number | null, decryptedTaxRate: number | null) => JSX.Element;
}> = ({ refund, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData, renderAnalysisChart }) => {
  const handleDecrypt = async () => {
    if (decryptedData.amount !== null) { 
      setDecryptedData({ amount: null, taxRate: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ amount: decrypted, taxRate: decrypted });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="refund-detail-modal">
        <div className="modal-header">
          <h2>Tax Refund Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="refund-info">
            <div className="info-item">
              <span>Receipt Description:</span>
              <strong>{refund.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{refund.creator.substring(0, 6)}...{refund.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(refund.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Tax Rate:</span>
              <strong>{refund.publicValue1}%</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Receipt Data</h3>
            
            <div className="data-row">
              <div className="data-label">Receipt Amount:</div>
              <div className="data-value">
                {refund.isVerified && refund.decryptedValue ? 
                  `$${refund.decryptedValue} (On-chain Verified)` : 
                  decryptedData.amount !== null ? 
                  `$${decryptedData.amount} (Locally Decrypted)` : 
                  "🔒 FHE Encrypted Integer"
                }
              </div>
              <button 
                className={`decrypt-btn ${(refund.isVerified || decryptedData.amount !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : refund.isVerified ? (
                  "✅ Verified"
                ) : decryptedData.amount !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Decryption"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 Privacy-Preserving</strong>
                <p>Receipt data stays encrypted on-chain. Click "Verify Decryption" for offline FHE computation and on-chain verification.</p>
              </div>
            </div>
          </div>
          
          {(refund.isVerified || decryptedData.amount !== null) && (
            <div className="analysis-section">
              <h3>Refund Analysis</h3>
              {renderAnalysisChart(
                refund, 
                refund.isVerified ? refund.decryptedValue || null : decryptedData.amount, 
                null
              )}
              
              <div className="decrypted-values">
                <div className="value-item">
                  <span>Receipt Amount:</span>
                  <strong>
                    {refund.isVerified ? 
                      `$${refund.decryptedValue} (On-chain Verified)` : 
                      `$${decryptedData.amount} (Locally Decrypted)`
                    }
                  </strong>
                  <span className={`data-badge ${refund.isVerified ? 'verified' : 'local'}`}>
                    {refund.isVerified ? 'On-chain Verified' : 'Local Decryption'}
                  </span>
                </div>
                <div className="value-item">
                  <span>Tax Rate:</span>
                  <strong>{refund.publicValue1}%</strong>
                  <span className="data-badge public">Public Data</span>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!refund.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying on-chain..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const FAQModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const faqs = [
    {
      question: "What is FHE (Fully Homomorphic Encryption)?",
      answer: "FHE allows computations on encrypted data without decrypting it first, ensuring complete privacy throughout the tax refund process."
    },
    {
      question: "How does TaxBack_Z protect my data?",
      answer: "Your receipt data is encrypted locally and stays encrypted during all computations. Only you can decrypt the final result."
    },
    {
      question: "What types of data can be processed?",
      answer: "Currently supports integer amounts only. Future versions will support more data types."
    },
    {
      question: "Is my tax information stored on-chain?",
      answer: "Only encrypted data is stored on-chain. The private keys remain securely in your wallet."
    }
  ];

  return (
    <div className="modal-overlay">
      <div className="faq-modal">
        <div className="modal-header">
          <h2>FHE Tax Refund FAQ</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="faq-list">
            {faqs.map((faq, index) => (
              <div key={index} className="faq-item">
                <h4>{faq.question}</h4>
                <p>{faq.answer}</p>
              </div>
            ))}
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;

