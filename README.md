# Red or Black Casino

A real-time gambling game built with Node.js, Express, Socket.IO, and MongoDB.

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure ports:**
   - Backend port: Set `PORT` in `.env` file (default: 5500)
   - Frontend port: Update `API_URL` and `WS_URL` in `public/config.js`

3. **Start the server:**
   ```bash
   node server.js
   ```

4. **Open the frontend:**
   - Serve `public/index.html` on any port (e.g., using Live Server on port 5500)

## Configuration

### Backend (.env file)
```env
PORT=5500
MONGODB_URI=mongodb://localhost:27017/token_gamble
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
TOKEN_MINT=So11111111111111111111111111111111111111112
MIN_TOKEN_BALANCE=1000000
ROUND_DURATION=600000
```

### Frontend (public/config.js)
```javascript
const CONFIG = {
    API_URL: 'http://localhost:5500',
    WS_URL: 'http://localhost:5500',
    IS_DEVELOPMENT: true
};
```

## Changing Ports

To change ports in the future:

1. **Backend:** Update `PORT` in `.env` file
2. **Frontend:** Update `API_URL` and `WS_URL` in `public/config.js`
3. **Restart the server**

## Features

- Real-time voting with WebSockets
- Wallet verification with Solana token balance
- Live vote counting and statistics
- Responsive neon-themed UI
- Admin panel for prize management

## API Endpoints

- `GET /api/status` - Get current game state
- `GET /api/participants` - Get current round participants
- `POST /api/verify-wallet` - Verify wallet token balance
- `POST /api/vote` - Cast a vote (red/black)
- `GET /api/health` - Health check
