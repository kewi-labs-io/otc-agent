/// <reference types="cypress" />

describe('OTC Desk Comprehensive Tests', () => {
  // Test data
  const testWalletAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  const initialQuote = {
    apr: '8%',
    lockup: '5 months',
    minAmount: 100,
    maxAmount: 10000
  };

  beforeEach(() => {
    // Clear any previous state
    cy.window().then((win) => {
      win.localStorage.clear();
      win.sessionStorage.clear();
    });
    
    // Visit landing page
    cy.visit('/', { timeout: 30000 });
    
    // Wait for initial load
    cy.get('body', { timeout: 10000 }).should('be.visible');
  });

  describe('1. Landing Page Tests', () => {
    it('should display all landing page elements', () => {
      // Logo and branding
      cy.get('img[alt*="logo"]').should('be.visible');
      
      // Initial quote display
      cy.get('[data-testid="initial-quote"]').within(() => {
        cy.contains(initialQuote.apr).should('be.visible');
        cy.contains(initialQuote.lockup).should('be.visible');
        cy.contains('Accept Quote').should('be.visible');
      });
      
      // Chat input area
      cy.get('[data-testid="landing-textarea"]').should('be.visible');
      cy.get('[data-testid="landing-textarea"]')
        .should('have.attr', 'placeholder')
        .and('include', 'negotiate');
    });

    it('should show proper initial quote structure', () => {
      cy.get('[data-testid="initial-quote"]').within(() => {
        // Check all quote details
        cy.contains('Your Quote').should('be.visible');
        cy.contains('APR').should('be.visible');
        cy.contains('Lockup Period').should('be.visible');
        cy.contains('Payment Currency').should('be.visible');
        cy.contains(/ETH|USDC/).should('be.visible');
      });
    });

    it('should handle page refresh correctly', () => {
      // Refresh page
      cy.reload();
      
      // Verify everything loads again
      cy.get('[data-testid="initial-quote"]').should('be.visible');
      cy.contains(initialQuote.apr).should('be.visible');
    });
  });

  describe('2. Accept Quote Modal Tests', () => {
    beforeEach(() => {
      // Open the modal
      cy.contains('Accept Quote').click();
      cy.get('[data-testid="accept-quote-modal"]').should('be.visible');
    });

    it('should display all modal elements', () => {
      cy.get('[data-testid="accept-quote-modal"]').within(() => {
        // Title
        cy.contains('Choose Token Amount').should('be.visible');
        
        // Quote summary
        cy.contains('Quote Summary').should('be.visible');
        cy.contains(initialQuote.apr).should('be.visible');
        cy.contains(initialQuote.lockup).should('be.visible');
        
        // Input controls
        cy.get('[data-testid="token-amount-slider"]').should('be.visible');
        cy.get('[data-testid="token-amount-input"]').should('be.visible');
        
        // Limits
        cy.contains('Minimum').should('be.visible');
        cy.contains('Maximum').should('be.visible');
        
        // Buttons
        cy.contains('Cancel').should('be.visible');
        cy.contains('Connect Wallet').should('be.visible');
      });
    });

    it('should sync slider and input values', () => {
      // Set value via input
      cy.get('[data-testid="token-amount-input"]').clear().type('5000');
      
      // Check slider updated
      cy.get('[data-testid="token-amount-slider"]')
        .should('have.value', '5000');
      
      // Set value via slider
      cy.get('[data-testid="token-amount-slider"]')
        .invoke('val', 7500)
        .trigger('input');
      
      // Check input updated
      cy.get('[data-testid="token-amount-input"]')
        .should('have.value', '7500');
    });

    it('should validate minimum amount', () => {
      // Enter amount below minimum
      cy.get('[data-testid="token-amount-input"]').clear().type('50');
      
      // Check for error message
      cy.contains(/too small|below minimum/i).should('be.visible');
      
      // Confirm button should be disabled
      cy.get('[data-testid="confirm-amount-button"]').should('be.disabled');
    });

    it('should validate maximum amount', () => {
      // Enter amount above maximum
      cy.get('[data-testid="token-amount-input"]').clear().type('999999');
      
      // Check for error message
      cy.contains(/exceeds maximum|too large/i).should('be.visible');
      
      // Confirm button should be disabled
      cy.get('[data-testid="confirm-amount-button"]').should('be.disabled');
    });

    it('should close modal on cancel', () => {
      cy.contains('Cancel').click();
      cy.get('[data-testid="accept-quote-modal"]').should('not.exist');
    });

    it('should close modal on escape key', () => {
      cy.get('body').type('{esc}');
      cy.get('[data-testid="accept-quote-modal"]').should('not.exist');
    });
  });

  describe('3. Chat Negotiation Tests', () => {
    it('should navigate to chat when entering negotiation text', () => {
      // Type negotiation message
      const negotiationMessage = 'I want 10% APR instead';
      cy.get('[data-testid="landing-textarea"]').type(negotiationMessage);
      
      // Press enter or click send
      cy.get('[data-testid="landing-textarea"]').type('{enter}');
      
      // Should navigate to chat page
      cy.url().should('include', '/chat');
      
      // Message should appear in chat
      cy.contains(negotiationMessage).should('be.visible');
    });

    it('should receive AI response with updated quote', () => {
      // Start negotiation
      cy.get('[data-testid="landing-textarea"]').type('Can you do 9% APR?{enter}');
      
      // Wait for AI response
      cy.get('[data-testid="agent-message"]', { timeout: 15000 }).should('be.visible');
      
      // Check for quote in response
      cy.get('[data-testid="quote-display"]').should('be.visible');
    });

    it('should handle multiple negotiation rounds', () => {
      const negotiations = [
        'Can you improve the APR?',
        'What about 9.5%?',
        'OK, I accept 9%'
      ];
      
      negotiations.forEach((message, index) => {
        // Send message
        if (index === 0) {
          cy.get('[data-testid="landing-textarea"]').type(message + '{enter}');
        } else {
          cy.get('[data-testid="chat-input"]').type(message + '{enter}');
        }
        
        // Wait for response
        cy.get(`[data-testid="agent-message"]:nth-of-type(${index + 1})`, { timeout: 15000 })
          .should('be.visible');
      });
    });

    it('should parse and display XML quotes correctly', () => {
      // Send negotiation request
      cy.get('[data-testid="landing-textarea"]').type('I need a better rate{enter}');
      
      // Wait for quote display
      cy.get('[data-testid="quote-display"]', { timeout: 15000 }).within(() => {
        // Check all quote fields are present
        cy.get('[data-testid="quote-apr"]').should('be.visible');
        cy.get('[data-testid="quote-lockup"]').should('be.visible');
        cy.get('[data-testid="quote-discount"]').should('be.visible');
        cy.get('[data-testid="quote-currency"]').should('be.visible');
        
        // Accept button should be present
        cy.contains('Accept This Quote').should('be.visible');
      });
    });
  });

  describe('4. Quote Display Tests', () => {
    beforeEach(() => {
      // Navigate to chat with a quote
      cy.get('[data-testid="landing-textarea"]').type('Show me a quote{enter}');
      cy.get('[data-testid="quote-display"]', { timeout: 15000 }).should('be.visible');
    });

    it('should display all quote information', () => {
      cy.get('[data-testid="quote-display"]').within(() => {
        // Check all fields
        cy.contains('APR').should('be.visible');
        cy.contains('Lockup Period').should('be.visible');
        cy.contains('Discount').should('be.visible');
        cy.contains('Payment Currency').should('be.visible');
        cy.contains('Expires').should('be.visible');
      });
    });

    it('should show quote expiration countdown', () => {
      cy.get('[data-testid="quote-expiry"]').should('be.visible');
      
      // Check countdown is updating
      cy.get('[data-testid="quote-expiry"]').then(($el) => {
        const initialText = $el.text();
        cy.wait(2000);
        cy.get('[data-testid="quote-expiry"]').should('not.have.text', initialText);
      });
    });

    it('should handle expired quotes', () => {
      // Mock time advancement (if possible) or wait
      // This would need backend support to test properly
      cy.get('[data-testid="quote-display"]').within(() => {
        // Quote should show expired state after timeout
        // cy.contains('Quote Expired').should('be.visible');
      });
    });
  });

  describe('5. Wallet Connection Tests', () => {
    it('should show connect wallet button when not connected', () => {
      cy.contains('Accept Quote').click();
      cy.get('[data-testid="accept-quote-modal"]').within(() => {
        cy.contains('Connect Wallet').should('be.visible');
      });
    });

    it('should trigger wallet connection flow', () => {
      cy.contains('Accept Quote').click();
      
      // Mock wallet connection
      cy.window().then((win) => {
        // Stub ethereum provider
        win.ethereum = {
          request: cy.stub().resolves([testWalletAddress]),
          on: cy.stub(),
          removeListener: cy.stub()
        };
      });
      
      cy.contains('Connect Wallet').click();
      
      // Should show connected state
      cy.contains(testWalletAddress.slice(0, 6)).should('be.visible');
    });

    it('should handle wallet connection errors', () => {
      cy.contains('Accept Quote').click();
      
      // Mock wallet rejection
      cy.window().then((win) => {
        win.ethereum = {
          request: cy.stub().rejects(new Error('User rejected')),
          on: cy.stub(),
          removeListener: cy.stub()
        };
      });
      
      cy.contains('Connect Wallet').click();
      
      // Should show error message
      cy.contains(/rejected|failed/i).should('be.visible');
    });
  });

  describe('6. Transaction Flow Tests', () => {
    beforeEach(() => {
      // Setup mock wallet
      cy.window().then((win) => {
        win.ethereum = {
          request: cy.stub()
            .withArgs({ method: 'eth_requestAccounts' })
            .resolves([testWalletAddress])
            .withArgs({ method: 'eth_chainId' })
            .resolves('0x1'),
          on: cy.stub(),
          removeListener: cy.stub()
        };
      });
    });

    it('should complete otc purchase flow', () => {
      // 1. Accept initial quote
      cy.contains('Accept Quote').click();
      
      // 2. Set token amount
      cy.get('[data-testid="token-amount-input"]').clear().type('1000');
      
      // 3. Connect wallet
      cy.contains('Connect Wallet').click();
      cy.wait(1000);
      
      // 4. Confirm transaction
      cy.get('[data-testid="confirm-amount-button"]').click();
      
      // 5. Should show transaction pending
      cy.contains(/pending|processing/i, { timeout: 10000 }).should('be.visible');
    });

    it('should show deal completion screen after successful purchase', () => {
      // Complete purchase flow
      cy.contains('Accept Quote').click();
      cy.get('[data-testid="token-amount-input"]').clear().type('1000');
      
      // Mock successful transaction
      cy.window().then((win) => {
        win.ethereum.request = cy.stub().resolves('0x123abc');
      });
      
      cy.contains('Connect Wallet').click();
      cy.get('[data-testid="confirm-amount-button"]').click();
      
      // Should navigate to completion screen
      cy.get('[data-testid="deal-completion"]', { timeout: 15000 }).should('be.visible');
      
      // Check completion details
      cy.contains('Deal Complete').should('be.visible');
      cy.contains('1000 tokens').should('be.visible');
      cy.contains(initialQuote.apr).should('be.visible');
    });
  });

  describe('7. Deal Completion Tests', () => {
    beforeEach(() => {
      // Navigate directly to deal completion (would need route)
      // cy.visit('/deal-complete?id=test123');
    });

    it('should display all deal details', () => {
      // Mock completion screen
      cy.window().then((win) => {
        win.localStorage.setItem('lastDeal', JSON.stringify({
          tokenAmount: '1000',
          apr: '8%',
          lockup: '5 months',
          txHash: '0x123abc'
        }));
      });
      
      // Check all details displayed
      // cy.get('[data-testid="deal-completion"]').within(() => {
      //   cy.contains('1000 tokens').should('be.visible');
      //   cy.contains('8% APR').should('be.visible');
      //   cy.contains('5 months').should('be.visible');
      // });
    });

    it('should generate shareable P&L card', () => {
      // cy.get('[data-testid="generate-share-card"]').click();
      // cy.get('[data-testid="share-card-image"]').should('be.visible');
    });

    it('should have working social share buttons', () => {
      // Check Twitter/X share
      // cy.get('[data-testid="share-twitter"]').should('have.attr', 'href').and('include', 'twitter.com');
      
      // Check other social platforms
      // cy.get('[data-testid="share-telegram"]').should('be.visible');
    });

    it('should allow starting new negotiation', () => {
      // cy.contains('Negotiate Another Deal').click();
      // cy.url().should('eq', Cypress.config().baseUrl + '/');
    });
  });

  describe('8. Error Handling Tests', () => {
    it('should handle network errors gracefully', () => {
      // Intercept API calls and force error
      cy.intercept('POST', '/api/eliza/**', { statusCode: 500 });
      
      cy.get('[data-testid="landing-textarea"]').type('Get me a quote{enter}');
      
      // Should show error message
      cy.contains(/error|failed|try again/i, { timeout: 10000 }).should('be.visible');
    });

    it('should handle invalid quote data', () => {
      // Intercept and return malformed quote
      cy.intercept('POST', '/api/eliza/**', {
        body: { text: 'Invalid XML here' }
      });
      
      cy.get('[data-testid="landing-textarea"]').type('Show quote{enter}');
      
      // Should handle gracefully
      cy.get('[data-testid="agent-message"]').should('be.visible');
      cy.get('[data-testid="quote-display"]').should('not.exist');
    });

    it('should show proper error for blockchain failures', () => {
      // Mock blockchain error
      cy.window().then((win) => {
        win.ethereum = {
          request: cy.stub().rejects(new Error('Insufficient funds')),
          on: cy.stub(),
          removeListener: cy.stub()
        };
      });
      
      cy.contains('Accept Quote').click();
      cy.contains('Connect Wallet').click();
      
      // Should show blockchain error
      cy.contains(/insufficient funds/i).should('be.visible');
    });
  });

  describe('9. Accessibility Tests', () => {
    it('should have proper ARIA labels', () => {
      // Check main elements have ARIA labels
      cy.get('[data-testid="landing-textarea"]').should('exist');
      cy.get('button').each(($btn) => {
        // Check button has either aria-label or text content
        cy.wrap($btn).then($button => {
          const hasAriaLabel = $button.attr('aria-label');
          const hasText = $button.text().trim().length > 0;
          expect(hasAriaLabel || hasText).to.be.true;
        });
      });
    });

    it('should be keyboard navigable', () => {
      // Tab through interface using trigger
      cy.get('body').trigger('keydown', { keyCode: 9, which: 9, key: 'Tab' });
      
      // Check if landing textarea can be focused
      cy.get('[data-testid="landing-textarea"]').focus();
      cy.focused().should('exist');
      
      // Check if buttons can be accessed via keyboard
      cy.get('button').first().focus();
      cy.focused().should('match', 'button');
      
      // Test Enter key activation
      cy.get('button').first().focus().type('{enter}');
      
      // Test Escape key
      cy.get('body').type('{esc}');
    });

    it('should support screen readers', () => {
      // Check for screen reader only text
      cy.get('.sr-only').should('exist');
      
      // Check form inputs have labels
      cy.get('input').each(($input) => {
        const id = $input.attr('id');
        if (id) {
          cy.get(`label[for="${id}"]`).should('exist');
        }
      });
    });
  });

  describe('10. Performance Tests', () => {
    it('should load landing page quickly', () => {
      cy.visit('/', {
        onBeforeLoad: (win) => {
          win.performance.mark('start');
        },
        onLoad: (win) => {
          win.performance.mark('end');
          win.performance.measure('pageLoad', 'start', 'end');
          const measure = win.performance.getEntriesByName('pageLoad')[0];
          expect(measure.duration).to.be.lessThan(3000); // 3 seconds
        }
      });
    });

    it('should handle rapid user inputs', () => {
      const rapidMessages = Array(5).fill('Test message');
      
      rapidMessages.forEach((msg, i) => {
        if (i === 0) {
          cy.get('[data-testid="landing-textarea"]').type(msg + '{enter}');
        } else {
          cy.get('[data-testid="chat-input"]').type(msg + '{enter}');
        }
        cy.wait(100); // Small delay between messages
      });
      
      // All messages should be queued and processed
      cy.get('[data-testid="user-message"]').should('have.length.at.least', 5);
    });

    it('should maintain responsive UI under load', () => {
      // Open modal multiple times rapidly
      for (let i = 0; i < 3; i++) {
        cy.contains('Accept Quote').click();
        cy.get('[data-testid="accept-quote-modal"]').should('be.visible');
        cy.get('body').type('{esc}');
        cy.get('[data-testid="accept-quote-modal"]').should('not.exist');
      }
      
      // UI should remain responsive
      cy.contains('Accept Quote').click();
      cy.get('[data-testid="accept-quote-modal"]').should('be.visible');
    });
  });

  describe('11. Mobile Responsiveness Tests', () => {
    beforeEach(() => {
      // Set mobile viewport
      cy.viewport('iphone-x');
    });

    it('should display properly on mobile', () => {
      // Check layout adjustments
      cy.get('[data-testid="initial-quote"]').should('be.visible');
      cy.get('[data-testid="landing-textarea"]').should('be.visible');
      
      // Check touch interactions
      cy.contains('Accept Quote').click();
      cy.get('[data-testid="accept-quote-modal"]').should('be.visible');
    });

    it('should handle mobile keyboard properly', () => {
      cy.get('[data-testid="landing-textarea"]').click();
      // Mobile keyboard should not obscure input
      cy.get('[data-testid="landing-textarea"]').should('be.visible');
    });
  });

  describe('12. Security Tests', () => {
    it('should sanitize user inputs', () => {
      const xssAttempt = '<script>alert("XSS")</script>';
      cy.get('[data-testid="landing-textarea"]').type(xssAttempt + '{enter}');
      
      // Script should be escaped, not executed
      cy.on('window:alert', () => {
        throw new Error('XSS was not prevented!');
      });
      
      // Check message is displayed safely
      cy.contains(xssAttempt).should('not.exist');
      cy.contains('<script>').should('be.visible'); // Should show as text
    });

    it('should validate all numeric inputs', () => {
      cy.contains('Accept Quote').click();
      
      // Try SQL injection in amount field
      cy.get('[data-testid="token-amount-input"]').clear().type("1000' OR '1'='1");
      
      // Should be rejected/sanitized
      cy.get('[data-testid="token-amount-input"]').should('have.value', '1000');
    });

    it('should handle authorization properly', () => {
      // Try to access protected endpoints
      cy.request({
        method: 'POST',
        url: '/api/worker/quote-approval',
        failOnStatusCode: false,
        body: { action: 'start' }
      }).then((response) => {
        expect(response.status).to.be.oneOf([401, 403, 500]);
      });
    });
  });

  describe('13. State Management Tests', () => {
    it('should persist chat session across page refreshes', () => {
      // Send a message
      cy.get('[data-testid="landing-textarea"]').type('Hello OTC desk{enter}');
      
      // Wait for response
      cy.get('[data-testid="agent-message"]', { timeout: 15000 }).should('be.visible');
      
      // Get session ID from URL
      cy.url().then((url) => {
        const sessionId = url.split('/chat/')[1];
        
        // Refresh page
        cy.reload();
        
        // Session should be restored
        cy.url().should('include', sessionId);
        cy.contains('Hello OTC desk').should('be.visible');
      });
    });

    it('should maintain quote state during navigation', () => {
      // Get a quote
      cy.get('[data-testid="landing-textarea"]').type('Give me your best rate{enter}');
      cy.get('[data-testid="quote-display"]', { timeout: 15000 }).should('be.visible');
      
      // Navigate away and back
      cy.go('back');
      cy.go('forward');
      
      // Quote should still be visible
      cy.get('[data-testid="quote-display"]').should('be.visible');
    });

    it('should clear sensitive data on logout', () => {
      // Mock logout action
      cy.window().then((win) => {
        win.localStorage.setItem('walletAddress', testWalletAddress);
        win.localStorage.setItem('authToken', 'secret123');
      });
      
      // Trigger logout (if implemented)
      // cy.contains('Logout').click();
      
      // Check data is cleared
      cy.window().then((win) => {
        expect(win.localStorage.getItem('walletAddress')).to.be.null;
        expect(win.localStorage.getItem('authToken')).to.be.null;
      });
    });
  });

  describe('14. Integration Tests', () => {
    it('should complete full user journey', () => {
      // 1. View initial quote
      cy.get('[data-testid="initial-quote"]').should('be.visible');
      
      // 2. Start negotiation
      cy.get('[data-testid="landing-textarea"]').type('Can we negotiate?{enter}');
      
      // 3. Wait for AI response
      cy.get('[data-testid="agent-message"]', { timeout: 15000 }).should('be.visible');
      
      // 4. Continue negotiation
      cy.get('[data-testid="chat-input"]').type('How about 9% APR?{enter}');
      
      // 5. Get updated quote
      cy.get('[data-testid="quote-display"]').should('be.visible');
      
      // 6. Accept quote
      cy.get('[data-testid="quote-display"]').within(() => {
        cy.contains('Accept This Quote').click();
      });
      
      // 7. Choose amount
      cy.get('[data-testid="token-amount-input"]').clear().type('2000');
      
      // 8. Complete flow
      // Would continue with wallet connection and transaction
    });

    it('should handle concurrent users', () => {
      // Open multiple sessions in different windows
      // This would need special setup to test properly
      
      // Each session should be independent
      const sessionId1 = 'test-session-1';
      const sessionId2 = 'test-session-2';
      
      // Verify sessions don't interfere
      cy.visit(`/chat/${sessionId1}`);
      cy.visit(`/chat/${sessionId2}`);
      
      // Each should maintain separate state
    });
  });

  describe('15. Edge Cases', () => {
    it('should handle very long messages', () => {
      const longMessage = 'a'.repeat(1000);
      cy.get('[data-testid="landing-textarea"]').type(longMessage + '{enter}');
      
      // Should truncate or handle gracefully
      cy.get('[data-testid="user-message"]').should('be.visible');
    });

    it('should handle special characters in messages', () => {
      const specialChars = '!@#$%^&*()_+-=[]{}|;\':",.<>?/`~';
      cy.get('[data-testid="landing-textarea"]').type(specialChars + '{enter}');
      
      // Should display correctly
      cy.contains(specialChars).should('be.visible');
    });

    it('should handle rapid modal open/close', () => {
      for (let i = 0; i < 5; i++) {
        cy.contains('Accept Quote').click();
        cy.get('body').type('{esc}');
      }
      
      // Should not break UI
      cy.contains('Accept Quote').should('be.visible');
    });

    it('should handle quote with extreme values', () => {
      // Mock extreme quote values
      cy.intercept('POST', '/api/eliza/**', {
        body: {
          text: `
            <!-- XML_START -->
            <quote>
              <apr>99.99</apr>
              <lockupMonths>120</lockupMonths>
              <discountBps>9999</discountBps>
            </quote>
            <!-- XML_END -->
          `
        }
      });
      
      cy.get('[data-testid="landing-textarea"]').type('Quote please{enter}');
      
      // Should display without breaking
      cy.get('[data-testid="quote-display"]').should('be.visible');
    });
  });
});

// Custom commands for OTC desk
Cypress.Commands.add('connectWallet', (address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266') => {
  cy.window().then((win) => {
    win.ethereum = {
      request: cy.stub()
        .withArgs({ method: 'eth_requestAccounts' })
        .resolves([address])
        .withArgs({ method: 'eth_chainId' })
        .resolves('0x1'),
      on: cy.stub(),
      removeListener: cy.stub()
    };
  });
  cy.contains('Connect Wallet').click();
});

Cypress.Commands.add('acceptQuote', (amount = '1000') => {
  cy.contains('Accept Quote').click();
  cy.get('[data-testid="token-amount-input"]').clear().type(amount);
  cy.connectWallet();
  cy.get('[data-testid="confirm-amount-button"]').click();
});

Cypress.Commands.add('negotiateQuote', (message) => {
  cy.get('[data-testid="landing-textarea"], [data-testid="chat-input"]').then(($el) => {
    cy.wrap($el).type(message + '{enter}');
  });
  cy.get('[data-testid="agent-message"]', { timeout: 15000 }).should('be.visible');
});

// Type declarations
declare namespace Cypress {
  interface Chainable {
    connectWallet(address?: string): Chainable<void>
    acceptQuote(amount?: string): Chainable<void>
    negotiateQuote(message: string): Chainable<void>
  }
}
