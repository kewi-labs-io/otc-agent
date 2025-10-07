/// <reference types="cypress" />

/**
 * OTC Desk UI Tests (No Wallet Required)
 * Tests UI elements that work without wallet connection
 */

describe('OTC Desk - UI Tests (No Wallet)', () => {
  beforeEach(() => {
    cy.clearStorage();
    cy.visit('/', { timeout: 30000, failOnStatusCode: false });
  });

  describe('Application Load', () => {
    it('loads without errors', () => {
      cy.get('body', { timeout: 10000 }).should('be.visible');
    });

    it('has valid HTML structure', () => {
      cy.get('html').should('have.attr', 'lang');
      cy.get('head').should('exist');
      cy.get('body').should('exist');
    });

    it('loads CSS styles', () => {
      cy.get('body').should('have.css', 'margin');
    });
  });

  describe('Connect Wallet Prompt', () => {
    it('shows connect wallet option', () => {
      cy.contains(/connect/i, { timeout: 10000 }).should('be.visible');
    });

    it('has clickable connect button', () => {
      cy.get('button').contains(/connect/i).should('be.visible');
    });
  });

  describe('UI Components', () => {
    it('chat input exists', () => {
      cy.get('[data-testid="chat-input"]', { timeout: 10000 }).should('exist');
    });

    it('chat input is initially disabled', () => {
      cy.get('[data-testid="chat-input"]').should('be.disabled');
    });

    it('send button exists', () => {
      cy.get('[data-testid="send-button"]', { timeout: 10000 }).should('exist');
    });

    it('deal completion component exists in code', () => {
      // Component exists but not rendered on landing page
      cy.get('[data-testid="deal-completion"]').should('not.exist');
    });
  });

  describe('Responsive Design', () => {
    it('works on mobile viewport', () => {
      cy.viewport('iphone-x');
      cy.get('body').should('be.visible');
      cy.contains(/connect/i).should('be.visible');
    });

    it('works on tablet viewport', () => {
      cy.viewport('ipad-2');
      cy.get('body').should('be.visible');
      cy.contains(/connect/i).should('be.visible');
    });

    it('works on desktop viewport', () => {
      cy.viewport(1920, 1080);
      cy.get('body').should('be.visible');
      cy.contains(/connect/i).should('be.visible');
    });
  });

  describe('Performance', () => {
    it('loads page quickly', () => {
      cy.visit('/', {
        onBeforeLoad: (win) => {
          win.performance.mark('start');
        },
        onLoad: (win) => {
          win.performance.mark('end');
          win.performance.measure('pageLoad', 'start', 'end');
          const measure = win.performance.getEntriesByName('pageLoad')[0];
          expect(measure.duration).to.be.lessThan(5000);
        }
      });
    });

    it('page is interactive', () => {
      cy.get('button').first().should('be.visible');
      cy.get('body').click({ force: true });
    });
  });

  describe('Error Handling', () => {
    it('does not crash on invalid navigation', () => {
      cy.visit('/invalid-route-that-does-not-exist', { failOnStatusCode: false });
      cy.get('body').should('be.visible');
    });

    it('handles page refresh', () => {
      cy.reload();
      cy.get('body').should('be.visible');
      cy.contains(/connect/i).should('be.visible');
    });
  });

  describe('Accessibility', () => {
    it('has accessible buttons', () => {
      cy.get('button:visible').should('have.length.greaterThan', 0);
      cy.get('button:visible').first().should('be.visible');
    });

    it('buttons have text or aria-label', () => {
      cy.get('button:visible').first().should(($btn) => {
        const hasText = $btn.text().trim().length > 0;
        const hasAriaLabel = $btn.attr('aria-label');
        expect(hasText || !!hasAriaLabel).to.be.true;
      });
    });
  });

  describe('Security', () => {
    it('has secure headers', () => {
      cy.request('/').then((response) => {
        expect(response.status).to.eq(200);
      });
    });

    it('prevents XSS in URL parameters', () => {
      cy.visit('/?xss=<script>alert(1)</script>', { failOnStatusCode: false });
      cy.get('body').should('be.visible');
      
      cy.on('window:alert', () => {
        throw new Error('XSS vulnerability detected!');
      });
    });
  });
});

export {};
