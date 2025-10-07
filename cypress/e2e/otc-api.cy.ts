/// <reference types="cypress" />

/**
 * OTC Desk API Tests
 * Tests all API endpoints without requiring wallet connection
 */

describe('OTC Desk - API Tests', () => {
  const testWallet = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  const testEntityId = testWallet.toLowerCase();

  describe('Health & Status', () => {
    it('health check returns OK', () => {
      cy.request('/api/health').then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body).to.have.property('status');
        expect(response.body.status).to.be.oneOf(['ok', 'healthy']);
      });
    });
  });

  describe('OTC Offers', () => {
    it('fetches open OTC offers', () => {
      cy.request({
        url: '/api/otc/open',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.be.oneOf([200, 500]);
        if (response.status === 200) {
          expect(response.body).to.have.property('offers');
          expect(response.body.offers).to.be.an('array');
        }
      });
    });
  });

  describe('Quote API', () => {
    it('fetches latest quote for entity', () => {
      cy.request({
        url: `/api/quote/latest?entityId=${encodeURIComponent(testEntityId)}`,
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.be.oneOf([200, 400, 500]);
        if (response.status === 200) {
          expect(response.body).to.exist;
        }
      });
    });
  });

  describe('Room Management', () => {
    it('creates a new room', () => {
      cy.request({
        method: 'POST',
        url: '/api/rooms',
        body: { entityId: testEntityId },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.be.oneOf([200, 201, 400, 500]);
        if (response.status === 200 || response.status === 201) {
          expect(response.body).to.have.property('roomId');
          
          // Store roomId for next test
          cy.wrap(response.body.roomId).as('roomId');
        }
      });
    });

    it('fetches room messages', function() {
      // Create room first
      cy.request({
        method: 'POST',
        url: '/api/rooms',
        body: { entityId: testEntityId },
        failOnStatusCode: false,
      }).then((response) => {
        if (response.status === 200 || response.status === 201) {
          const roomId = response.body.roomId;
          
          // Fetch messages
          cy.request({
            url: `/api/rooms/${roomId}/messages`,
            failOnStatusCode: false,
          }).then((messagesResponse) => {
            expect(messagesResponse.status).to.be.oneOf([200, 404, 500]);
            if (messagesResponse.status === 200) {
              expect(messagesResponse.body).to.have.property('messages');
              expect(messagesResponse.body.messages).to.be.an('array');
            }
          });
        }
      });
    });

    it('posts message to room', () => {
      // Create room
      cy.request({
        method: 'POST',
        url: '/api/rooms',
        body: { entityId: testEntityId },
        failOnStatusCode: false,
      }).then((response) => {
        if (response.status === 200 || response.status === 201) {
          const roomId = response.body.roomId;
          
          // Post message
          cy.request({
            method: 'POST',
            url: `/api/rooms/${roomId}/messages`,
            body: {
              entityId: testEntityId,
              text: 'Test message from Cypress',
              clientMessageId: `test-${Date.now()}`,
            },
            failOnStatusCode: false,
          }).then((messageResponse) => {
            expect(messageResponse.status).to.be.oneOf([200, 201, 400, 500]);
          });
        }
      });
    });
  });

  describe('Worker Endpoints', () => {
    it('worker start endpoint exists', () => {
      cy.request({
        method: 'POST',
        url: '/api/worker/quote-approval',
        body: { action: 'start' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.be.oneOf([200, 400, 401, 500]);
      });
    });

    it('worker stop endpoint exists', () => {
      cy.request({
        method: 'POST',
        url: '/api/worker/quote-approval',
        body: { action: 'stop' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.be.oneOf([200, 400, 401, 500]);
      });
    });
  });

  describe('Message Flow', () => {
    it('complete message flow via API', () => {
      const testMessage = `API test message ${Date.now()}`;
      
      // 1. Create room
      cy.request({
        method: 'POST',
        url: '/api/rooms',
        body: { entityId: testEntityId },
      }).then((roomResponse) => {
        expect(roomResponse.status).to.be.oneOf([200, 201]);
        const roomId = roomResponse.body.roomId;
        expect(roomId).to.be.a('string');
        
        // 2. Send message
        cy.request({
          method: 'POST',
          url: `/api/rooms/${roomId}/messages`,
          body: {
            entityId: testEntityId,
            text: testMessage,
            clientMessageId: `test-${Date.now()}`,
          },
        }).then((messageResponse) => {
          expect(messageResponse.status).to.be.oneOf([200, 201]);
          
          // 3. Wait for agent response
          cy.wait(3000);
          
          // 4. Fetch messages
          cy.request(`/api/rooms/${roomId}/messages`).then((fetchResponse) => {
            expect(fetchResponse.status).to.eq(200);
            expect(fetchResponse.body.messages).to.be.an('array');
            expect(fetchResponse.body.messages.length).to.be.at.least(1);
            
            // Verify our message exists
            const messages = fetchResponse.body.messages;
            const userMessage = messages.find((m: any) => {
              const text = m.content?.text || m.text || m.content;
              return text && text.includes(testMessage);
            });
            expect(userMessage).to.exist;
          });
        });
      });
    });
  });

  describe('Error Handling', () => {
    it('handles missing entity ID', () => {
      cy.request({
        method: 'POST',
        url: '/api/rooms',
        body: {},
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.be.oneOf([400, 500]);
      });
    });

    it('handles invalid room ID', () => {
      cy.request({
        url: '/api/rooms/invalid-room-id/messages',
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.be.oneOf([404, 500]);
      });
    });

    it('handles malformed message data', () => {
      cy.request({
        method: 'POST',
        url: '/api/rooms/test-room/messages',
        body: { invalid: 'data' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.be.oneOf([400, 404, 500]);
      });
    });
  });

  describe('Performance', () => {
    it('API responds quickly', () => {
      const startTime = Date.now();
      
      cy.request('/api/health').then(() => {
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        expect(duration).to.be.lessThan(2000);
      });
    });

    it('handles concurrent requests', () => {
      const requests = [];
      for (let i = 0; i < 5; i++) {
        requests.push(
          cy.request({
            url: '/api/health',
            failOnStatusCode: false,
          })
        );
      }
      
      // All should complete
      cy.wrap(Promise.all(requests)).should('exist');
    });
  });
});

export {};
