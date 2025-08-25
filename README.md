# 🚨 Blockchain-based Automated Product Recall Platform

Welcome to a revolutionary Web3 solution for supply chain safety! This project addresses the real-world problem of slow and inefficient product recalls, particularly in industries like food, pharmaceuticals, and consumer goods. Traditional recall processes often involve manual notifications, fragmented data, and delays that can lead to health risks, financial losses, and eroded trust. By leveraging the Stacks blockchain and Clarity smart contracts, this platform enables transparent tracking of product batches, automated detection and initiation of recalls for contaminated items, and instant on-chain alerts to all stakeholders (manufacturers, distributors, retailers, regulators, and consumers). Everything is immutable, auditable, and decentralized, reducing response times from days to minutes.

## ✨ Features

🔒 Stakeholder registration with role-based access (e.g., manufacturers, distributors, retailers, consumers)  
📦 Batch tracking throughout the supply chain for end-to-end visibility  
🚨 Automated recall initiation upon contamination reports or oracle-verified triggers  
🔔 Instant on-chain notifications and alerts to affected parties  
✅ Verification tools for checking product status and recall history  
📊 Immutable audit logs for compliance and post-recall analysis  
💰 Incentive mechanisms to encourage timely reporting and participation  
⚖️ Governance for platform updates and dispute resolution  
🔗 Integration with oracles for real-world data (e.g., lab test results)  
🛡️ Secure token-based interactions to prevent spam and ensure accountability

## 🛠 How It Works

The platform is built with 8 modular Clarity smart contracts, each handling a specific aspect of the system for scalability and maintainability. Interactions occur via contract calls, with events emitted for notifications. Users interact through a dApp frontend (not included in this repo, but can be built with Stacks.js).

### Core Workflow

1. **Registration**: Stakeholders register their identities and roles.
2. **Batch Creation & Tracking**: Manufacturers create product batches and log movements as they pass through the supply chain.
3. **Monitoring**: Oracles or authorized users report potential contaminations.
4. **Recall Trigger**: If verified, a recall is automatically initiated, marking affected batches.
5. **Notifications**: On-chain events alert all linked stakeholders instantly.
6. **Verification & Resolution**: Parties verify status, claim incentives, and log resolutions.
7. **Governance**: Community votes on updates.

**For Manufacturers**
- Register via the StakeholderRegistry contract.
- Create a new batch using BatchRegistry with details like product ID, hash of specs, and initial location.
- Update supply chain logs in SupplyChainTracker as batches move.
- If contamination is detected, report via ContaminationReporter to trigger RecallManager.

**For Distributors/Retailers**
- Claim ownership of batches in SupplyChainTracker.
- Subscribe to notifications in NotificationHub for real-time alerts.
- Verify batch status using StatusVerifier before sale.

**For Consumers/Regulators**
- Register and link to purchased batches (e.g., via QR code scans).
- Query StatusVerifier for recall info.
- Receive alerts from NotificationHub if affected.

**For All Users**
- Use GovernanceDAO for proposals/votes.
- Earn/redeem tokens via IncentivePool for actions like reporting issues.

### Smart Contracts Overview

This project involves 8 Clarity smart contracts for a robust, interconnected system:

1. **StakeholderRegistry.clar**: Manages user registration, roles (e.g., manufacturer, consumer), and KYC-like verification hashes. Prevents unauthorized access.
   
2. **BatchRegistry.clar**: Registers product batches with unique IDs, metadata (title, description, hash), and initial owner. Ensures no duplicates.

3. **SupplyChainTracker.clar**: Logs batch transfers between stakeholders, creating an immutable chain-of-custody trail. Emits events for each hop.

4. **ContaminationReporter.clar**: Allows authorized reports of issues (e.g., lab results via oracle). Stores evidence hashes and triggers verification.

5. **RecallManager.clar**: Automates recall logic: Marks batches as recalled, cross-references supply chain data, and initiates alerts if thresholds met.

6. **NotificationHub.clar**: Handles subscriptions and emits on-chain events/alerts to stakeholders linked to affected batches. Supports push-like notifications via dApp polling.

7. **StatusVerifier.clar**: Provides read-only queries for batch status, ownership history, and recall details. Useful for instant verifications.

8. **IncentivePool.clar**: Manages a token pool (using SIP-010 compatible tokens) to reward timely reports and penalize delays. Integrates with other contracts for automated payouts.

9. **OracleIntegrator.clar**: Interfaces with external oracles (e.g., for real-time contamination data). Validates and feeds data into reporter/recall contracts. (Note: This is the 9th for extensibility.)

10. **GovernanceDAO.clar**: Enables token holders to propose and vote on platform changes, like fee adjustments or new roles. Uses quadratic voting for fairness.

### Getting Started

1. Install Clarinet (Stacks dev tool): `cargo install clarinet`.
2. Clone this repo and navigate to the contracts folder.
3. Deploy contracts locally: `clarinet test` or deploy to Stacks testnet.
4. Example Call: Register a batch – `(contract-call? .BatchRegistry register-batch u123 "Batch-001" "Organic Apples - Lot A" (hash160 "file-hash"))`.
5. Build a frontend dApp to interact (use @stacks/transactions).

This setup ensures recalls are fast, transparent, and trustless, potentially saving lives and billions in recall costs annually! 🚀