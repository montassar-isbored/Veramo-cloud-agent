# Veramo-cloud-agent

## Description
Veramo-cloud-agent is the cloud agent and mediator component for the ClinConNet Self-Sovereign Identity (SSI) wallet ecosystem. Built with the VERAMO SDK, it handles DID communication (DID-Comm) mediation capabilities and acts as a secure bridging agent for the browser-based edge agent, facilitating consent exchanges and cross-origin resource sharing (CORS).

## Funding
Traceability for trusted multi-scale data and fight against information leak in daily practices and artificial intelligence systems in healthcare TracIA - ANR-22-PESN-0006 PESN - 2022

## Prerequisites
* Node.js (v18.x or later)
* NPM (Node Package Manager)

## Installation
1. Clone the repository:
   ```bash
   git clone [https://github.com/montassar-isbored/Veramo-cloud-agent.git]
   ```
2. Navigate to the project directory:
   ```bash
   cd Veramo-cloud-agent
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

## Usage
1. Start the cloud agent server:
   ```bash
   npm start
   ```

## Architecture & Technologies
* **Language:** JavaScript
* **Core Framework:** Node.js, VERAMO SDK
* **Database:** SQLite (local datastore for mediation and agent data)
* **Core Functionality:** DID-Comm routing, cloud mediation capabilities, SPA integration endpoint.
