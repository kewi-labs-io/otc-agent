// ***********************************************************
// This file is processed and loaded automatically before test files.
// You can change the location of this file or turn off processing it:
// https://on.cypress.io/configuration
// ***********************************************************

import './commands';
import '@testing-library/cypress/add-commands';

// Prevent Cypress from failing tests on uncaught exceptions
Cypress.on('uncaught:exception', (err, runnable) => {
  // Return false to prevent the error from failing the test
  // We expect some console errors during testing (e.g., wallet connection)
  return false;
});

// Add custom types
declare global {
  namespace Cypress {
    interface Chainable {
      /**
       * Custom command to create a quote via API
       */
      createQuote(tokenAmount: string, entityId?: string): Chainable<any>;
      
      /**
       * Custom command to start the quote approval worker
       */
      startWorker(): Chainable<any>;
      
      /**
       * Custom command to stop the quote approval worker
       */
      stopWorker(): Chainable<any>;
      
      /**
       * Custom command to send a message to the agent
       */
      sendAgentMessage(message: string, entityId?: string): Chainable<any>;
      
      /**
       * Custom command to wait for quote to appear in UI
       */
      waitForQuote(): Chainable<any>;
      
      /**
       * Custom command to connect test wallet
       */
      connectWallet(): Chainable<any>;
    }
  }
}

export {};

















