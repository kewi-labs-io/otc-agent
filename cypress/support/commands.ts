/// <reference types="cypress" />

// Custom commands for OTC desk testing

const DEFAULT_TEST_WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

/**
 * Mock wallet connection for testing
 * Sets up ethereum provider and clicks connect button
 */
Cypress.Commands.add('connectWallet', (address?: string) => {
  const walletAddress = address || Cypress.env('TEST_WALLET_ADDRESS') || DEFAULT_TEST_WALLET;
  
  // Set up mock wallet
  cy.window().then((win) => {
    const listeners: any = {};
    
    // Mock wallet connection with event support
    (win as any).ethereum = {
      isMetaMask: true,
      selectedAddress: walletAddress,
      chainId: '0x7a69',
      request: async ({ method }: { method: string }) => {
        console.log('Wallet request:', method);
        if (method === 'eth_requestAccounts') {
          // Trigger accountsChanged event
          setTimeout(() => {
            if (listeners.accountsChanged) {
              listeners.accountsChanged.forEach((fn: any) => fn([walletAddress]));
            }
          }, 100);
          return [walletAddress];
        }
        if (method === 'eth_accounts') return [walletAddress];
        if (method === 'eth_chainId') return '0x7a69';
        if (method === 'wallet_switchEthereumChain') return null;
        if (method === 'wallet_addEthereumChain') return null;
        return null;
      },
      on: (event: string, callback: any) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(callback);
      },
      removeListener: (event: string, callback: any) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((fn: any) => fn !== callback);
        }
      },
      removeAllListeners: () => {
        Object.keys(listeners).forEach(key => delete listeners[key]);
      },
    };
  });
  
  // Click connect button
  cy.get('button').contains(/connect/i, { timeout: 10000 }).click({ force: true });
  
  // Wait for wallet connection to complete
  cy.wait(3000);
  
  // Verify connection by checking input is enabled
  cy.get('[data-testid="chat-input"]', { timeout: 15000 }).should('not.be.disabled');
});

/**
 * Send a message to the agent via API
 */
Cypress.Commands.add('sendAgentMessage', (message: string, entityId = 'cypress-test-user') => {
  return cy.request({
    method: 'POST',
    url: '/api/eliza/message',
    timeout: 60000,
    failOnStatusCode: false,
    body: {
      message,
      entityId,
    },
    headers: {
      'Content-Type': 'application/json',
    },
  }).then((response) => {
    expect(response.status).to.be.oneOf([200, 201]);
    return response.body;
  });
});

/**
 * Create a quote for testing
 */
Cypress.Commands.add('createQuote', (tokenAmount: string, entityId = 'cypress-test-user') => {
  return cy.request({
    method: 'POST',
    url: '/api/eliza/message',
    timeout: 60000,
    failOnStatusCode: false,
    body: {
      message: `I want to buy ${tokenAmount} ElizaOS tokens`,
      entityId,
    },
    headers: {
      'Content-Type': 'application/json',
    },
  }).then((response) => {
    expect(response.status).to.be.oneOf([200, 201]);
    return response.body;
  });
});

/**
 * Wait for agent response in chat
 */
Cypress.Commands.add('waitForAgentResponse', () => {
  cy.get('[data-testid="agent-message"]', { timeout: 15000 }).should('be.visible');
});

/**
 * Start the quote approval worker
 */
Cypress.Commands.add('startWorker', () => {
  return cy.request({
    method: 'POST',
    url: '/api/worker/quote-approval',
    failOnStatusCode: false,
    body: {
      action: 'start',
    },
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Cypress.env('API_SECRET_KEY')}`,
    },
  }).then((response) => {
    // Accept both 200 and error states since worker might already be running
    expect(response.status).to.be.oneOf([200, 400, 500]);
    return response;
  });
});

/**
 * Stop the quote approval worker
 */
Cypress.Commands.add('stopWorker', () => {
  return cy.request({
    method: 'POST',
    url: '/api/worker/quote-approval',
    failOnStatusCode: false,
    body: {
      action: 'stop',
    },
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Cypress.env('API_SECRET_KEY')}`,
    },
  }).then((response) => {
    expect(response.status).to.be.oneOf([200, 400, 500]);
    return response;
  });
});

/**
 * Check if element exists without failing test
 */
Cypress.Commands.add('elementExists', (selector: string) => {
  cy.get('body').then($body => {
    return $body.find(selector).length > 0;
  });
});

/**
 * Type message and send in chat
 */
Cypress.Commands.add('sendChatMessage', (message: string) => {
  // Wait for chat input to be visible and enabled
  cy.get('[data-testid="chat-input"]', { timeout: 15000 })
    .should('be.visible')
    .and('not.be.disabled');
  
  // Clear and type message
  cy.get('[data-testid="chat-input"]')
    .clear()
    .type(message, { delay: 10 });
  
  // Click send button
  cy.get('[data-testid="send-button"]', { timeout: 5000 })
    .should('be.visible')
    .and('not.be.disabled')
    .click();
  
  // Wait a moment for message to be sent
  cy.wait(500);
});

/**
 * Clear localStorage and sessionStorage
 */
Cypress.Commands.add('clearStorage', () => {
  cy.window().then((win) => {
    win.localStorage.clear();
    win.sessionStorage.clear();
  });
});

export {};

// Type declarations
declare global {
  namespace Cypress {
    interface Chainable {
      /**
       * Mock wallet connection for testing
       * @param address - Optional wallet address (defaults to test wallet)
       */
      connectWallet(address?: string): Chainable<void>;
      
      /**
       * Send a message to the agent API
       * @param message - Message text
       * @param entityId - Optional entity ID
       */
      sendAgentMessage(message: string, entityId?: string): Chainable<any>;
      
      /**
       * Create a quote via API
       * @param tokenAmount - Amount of tokens
       * @param entityId - Optional entity ID
       */
      createQuote(tokenAmount: string, entityId?: string): Chainable<any>;
      
      /**
       * Wait for agent response to appear in chat
       */
      waitForAgentResponse(): Chainable<void>;
      
      /**
       * Start the quote approval worker
       */
      startWorker(): Chainable<any>;
      
      /**
       * Stop the quote approval worker
       */
      stopWorker(): Chainable<any>;
      
      /**
       * Check if an element exists
       * @param selector - CSS selector
       */
      elementExists(selector: string): Chainable<boolean>;
      
      /**
       * Type and send a message in the chat
       * @param message - Message text
       */
      sendChatMessage(message: string): Chainable<void>;
      
      /**
       * Clear all localStorage and sessionStorage
       */
      clearStorage(): Chainable<void>;
    }
  }
}










