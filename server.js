// server.js - Simple Gambling Backend with WebSockets (No Private Keys)
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { Connection, PublicKey } = require("@solana/web3.js");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:3000","http://localhost:5502"],
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 5500;

// Middleware
app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:3000","http://localhost:5502"],
    credentials: true,
  })
);
app.use(express.json());
app.use((req, res, next) => {
  res.header("Content-Type", "application/json");
  next();
});
app.use(express.static("public"));
app.use((req, res, next) => {
  res.header("Content-Type", "application/json");
  next();
});

// MongoDB Connection (optional for development)
mongoose.connect(
  process.env.MONGODB_URI || "mongodb://localhost:27017/token_gamble",
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  }
).catch(err => {
  console.log("⚠️ MongoDB not available, running in demo mode");
  console.log("📝 To enable full functionality, start MongoDB");
});

// Solana Connection (for token verification only)
const solanaConnection = new Connection(
  process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com"
);

// Configuration
const CONFIG = {
  REQUIRED_TOKEN_MINT:
    process.env.TOKEN_MINT || "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  MIN_TOKEN_BALANCE: parseInt(process.env.MIN_TOKEN_BALANCE) || 1000000, // 1M tokens
  ROUND_DURATION: parseInt(process.env.ROUND_DURATION) || 600000, // 10 minutes
};

// MongoDB Schemas
const participantSchema = new mongoose.Schema({
  walletAddress: { type: String, required: true, unique: true },
  tokenBalance: { type: Number, required: true },
  isVerified: { type: Boolean, default: false },
  lastVerified: { type: Date, default: Date.now },
});

const voteSchema = new mongoose.Schema({
  walletAddress: { type: String, required: true },
  roundId: { type: String, required: true },
  color: { type: String, enum: ["red", "black"], required: true },
  timestamp: { type: Date, default: Date.now },
});

const roundSchema = new mongoose.Schema({
  roundNumber: { type: Number, required: true, unique: true },
  status: {
    type: String,
    enum: ["voting", "spinning", "completed"],
    default: "voting",
  },
  startTime: { type: Date, default: Date.now },
  endTime: { type: Date },
  votes: {
    red: { type: Number, default: 0 },
    black: { type: Number, default: 0 },
  },
  participants: [{ type: String }], // wallet addresses
  winningColor: { type: String, enum: ["red", "black"] },
  winner: { type: String }, // wallet address of winner
  prizeAmount: { type: Number, default: 0 }, // Set by admin manually
});

const gameStateSchema = new mongoose.Schema({
  currentRound: { type: Number, default: 1 },
  totalPrizesGiven: { type: Number, default: 0 },
  lastWinner: { type: String },
  lastPrizeAmount: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  nextRoundStartTime: { type: Date },
  totalRoundsPlayed: { type: Number, default: 0 },
  lastUpdated: { type: Date, default: Date.now },
});

// Models
const Participant = mongoose.model("Participant", participantSchema);
const Vote = mongoose.model("Vote", voteSchema);
const Round = mongoose.model("Round", roundSchema);
const GameState = mongoose.model("GameState", gameStateSchema);

// Global game state
let currentGameState = null;
let roundTimer = null;
let connectedClients = 0;
let serverTimeLeft = 0;
let serverTimerInterval = null;
let currentPhase = 'verification'; // 'verification', 'voting', 'spinning', 'results'
let currentPhase = 'voting'; // 'voting', 'spinning', 'results'
let phaseTimeLeft = 0;

// WebSocket connection handling
io.on("connection", (socket) => {
  connectedClients++;
  console.log(`👤 Client connected. Total: ${connectedClients}`);

  // Send current game state to new client
  socket.emit("gameUpdate", getCurrentGameData());

  socket.on("disconnect", () => {
    connectedClients--;
    console.log(`👤 Client disconnected. Total: ${connectedClients}`);
  });
});

// Broadcast game updates to all clients
function broadcastGameUpdate() {
  const gameData = getCurrentGameData();
  io.emit("gameUpdate", gameData);
  console.log(`📡 Broadcasting update to ${connectedClients} clients`);
}

async function getCurrentGameData() {
  try {
    const currentRound = await Round.findOne({
      roundNumber: currentGameState.currentRound,
    }).sort({ _id: -1 });

    return {
      gameState: {
        currentRound: currentGameState.currentRound,
        timeLeft: phaseTimeLeft,
        currentPhase: currentPhase,
        totalPrizesGiven: currentGameState.totalPrizesGiven,
        totalRoundsPlayed: currentGameState.totalRoundsPlayed,
        lastWinner: currentGameState.lastWinner,
        lastPrizeAmount: currentGameState.lastPrizeAmount,
        isActive: currentGameState.isActive,
      },
      roundData: currentRound
        ? {
            status: currentRound.status,
            votes: currentRound.votes,
            participants: currentRound.participants.length,
            winningColor: currentRound.winningColor,
            winner: currentRound.winner,
            prizeAmount: currentRound.prizeAmount,
            startTime: currentRound.startTime,
          }
        : {
            status: "voting",
            votes: { red: 0, black: 0 },
            participants: 0,
            winningColor: null,
            winner: null,
            prizeAmount: 0,
            startTime: new Date(),
          },
      config: {
        minTokenBalance: CONFIG.MIN_TOKEN_BALANCE,
        roundDuration: CONFIG.ROUND_DURATION,
        tokenMint: CONFIG.REQUIRED_TOKEN_MINT,
      },
    };
  } catch (error) {
    // Demo mode fallback

    return {
      gameState: {
        currentRound: currentGameState.currentRound,
        timeLeft: phaseTimeLeft,
        currentPhase: currentPhase,
        totalPrizesGiven: currentGameState.totalPrizesGiven,
        totalRoundsPlayed: currentGameState.totalRoundsPlayed,
        lastWinner: currentGameState.lastWinner,
        lastPrizeAmount: currentGameState.lastPrizeAmount,
        isActive: currentGameState.isActive,
      },
      roundData: {
        status: "voting",
        votes: { red: 0, black: 0 },
        participants: 0,
        winningColor: null,
        winner: null,
        prizeAmount: 0,
        startTime: new Date(),
      },
      config: {
        minTokenBalance: CONFIG.MIN_TOKEN_BALANCE,
        roundDuration: CONFIG.ROUND_DURATION,
        tokenMint: CONFIG.REQUIRED_TOKEN_MINT,
      },
    };
  }
}

// Utility Functions
async function getTokenBalance(walletAddress, tokenMint) {
  try {
    const publicKey = new PublicKey(walletAddress);
    const tokenAccounts = await solanaConnection.getParsedTokenAccountsByOwner(
      publicKey,
      { mint: new PublicKey(tokenMint) }
    );

    if (tokenAccounts.value.length === 0) return 0;

    const balance =
      tokenAccounts.value[0].account.data.parsed.info.tokenAmount.amount;
    return parseInt(balance);
  } catch (error) {
    console.error("❌ Error getting token balance:", error);
    return 0;
  }
}

function isValidSolanaAddress(address) {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

// Game Logic Functions
async function initializeGameState() {
  try {
    currentGameState = await GameState.findOne();
    if (!currentGameState) {
      currentGameState = new GameState({
        currentRound: 1,
        totalPrizesGiven: 0,
      });
      await currentGameState.save();
    }

    await ensureCurrentRound();
    startVerificationPhase(); // This now starts voting phase directly
  } catch (error) {
    console.log("⚠️ Running in demo mode without database");
    // Create a mock game state for demo
    currentGameState = {
      currentRound: 1,
      totalPrizesGiven: 0,
      totalRoundsPlayed: 0,
      lastWinner: null,
      lastPrizeAmount: 0,
      isActive: true,
      lastUpdated: new Date()
    };
    startVerificationPhase(); // This now starts voting phase directly
  }
}

async function ensureCurrentRound() {
  try {
    const existingRound = await Round.findOne({
      roundNumber: currentGameState.currentRound,
      status: { $in: ["voting", "spinning"] },
    });

    if (!existingRound) {
      const newRound = new Round({
        roundNumber: currentGameState.currentRound,
        status: "voting",
        startTime: new Date(),
        prizeAmount: 0, // Admin sets this manually
      });
      await newRound.save();

      console.log(`🎲 NEW ROUND: ${currentGameState.currentRound} - VERIFICATION PHASE`);
      broadcastGameUpdate();
    }
  } catch (error) {
    console.log("⚠️ Demo mode: Round management disabled");
  }
}

// Phase Management Functions
function startVerificationPhase() {
  currentPhase = 'voting';
  phaseTimeLeft = 300; // 5 minutes for voting (verification can happen anytime)
  
  // Clear existing timers
  if (roundTimer) clearTimeout(roundTimer);
  if (serverTimerInterval) clearInterval(serverTimerInterval);
  
  console.log(`🗳️ VOTING PHASE: ${phaseTimeLeft} seconds`);
  console.log(`📝 Players can verify wallets and vote`);
  
  // Start phase countdown
  serverTimerInterval = setInterval(() => {
    phaseTimeLeft = Math.max(0, phaseTimeLeft - 1);
    
    // Broadcast update every 5 seconds during voting
    if (phaseTimeLeft % 5 === 0) {
      broadcastGameUpdate();
    }
    
    // End voting when time reaches 0
    if (phaseTimeLeft <= 0) {
      clearInterval(serverTimerInterval);
      endVotingPhase();
    }
  }, 1000);
  
  broadcastGameUpdate();
}
async function endVotingPhase() {
  currentPhase = 'spinning';
  phaseTimeLeft = 5; // 5 seconds for spinning animation
  
  const currentRound = await Round.findOne({
    roundNumber: currentGameState.currentRound,
    status: "voting",
  });

  if (!currentRound) return;

  // STEP 1: Randomly select winning color (50/50 chance) BEFORE spinning
  const winningColor = Math.random() < 0.5 ? "red" : "black";
  currentRound.winningColor = winningColor;
  currentRound.status = "spinning";
  await currentRound.save();

  console.log(`⏰ Voting ended for round ${currentGameState.currentRound}`);
  console.log(`🎰 Spinning the wheel...`);
  console.log(`🎯 Winning Color: ${winningColor.toUpperCase()} (SELECTED)`);

  // Start spinning countdown
  serverTimerInterval = setInterval(() => {
    phaseTimeLeft = Math.max(0, phaseTimeLeft - 1);
    broadcastGameUpdate();
    
    if (phaseTimeLeft <= 0) {
      clearInterval(serverTimerInterval);
    }
  }, 1000);

  broadcastGameUpdate();

  // Spin for 5 seconds then show result
  setTimeout(async () => {
    await performAutomaticSpin();
  }, 5000);
}

async function performAutomaticSpin() {
  currentPhase = 'results';
  phaseTimeLeft = 10; // 10 seconds to show results
  
  const currentRound = await Round.findOne({
    roundNumber: currentGameState.currentRound,
    status: "spinning",
  });

  if (!currentRound) return;

  // Get the winning color that was already set
  const winningColor = currentRound.winningColor;

  // STEP 1: Get all voters for the winning color
  const winningVotes = await Vote.find({
    roundId: currentRound.roundNumber.toString(),
    color: winningColor,
  });

  let winner = null;
  let eligibleVoters = [];

  if (winningVotes.length > 0) {
    // STEP 2: Randomly select winner from winning color voters only
    const randomIndex = Math.floor(Math.random() * winningVotes.length);
    winner = winningVotes[randomIndex].walletAddress;
    eligibleVoters = winningVotes.map(vote => vote.walletAddress);
  }

  currentRound.winner = winner;
  currentRound.status = "completed";
  currentRound.endTime = new Date();
  await currentRound.save();

  // Update game state
  currentGameState.lastWinner = winner;
  currentGameState.currentRound += 1;
  currentGameState.totalRoundsPlayed += 1;
  currentGameState.lastUpdated = new Date();
  await currentGameState.save();

  console.log(`🎰 ROUND ${currentRound.roundNumber} RESULTS:`);
  console.log(`🎯 Winning Color: ${winningColor.toUpperCase()} (CONFIRMED)`);
  console.log(`🎲 Eligible Voters: ${eligibleVoters.length} (${winningColor} voters)`);
  console.log(`🏆 Winner: ${winner || "No Winner"}`);
  console.log(
    `📊 Total Votes - Red: ${currentRound.votes.red}, Black: ${currentRound.votes.black}`
  );

  // Start results countdown
  serverTimerInterval = setInterval(() => {
    phaseTimeLeft = Math.max(0, phaseTimeLeft - 1);
    broadcastGameUpdate();
    
    if (phaseTimeLeft <= 0) {
      clearInterval(serverTimerInterval);
    }
  }, 1000);

  broadcastGameUpdate();

  // Start next round after 10 seconds
  setTimeout(async () => {
    await startNextRound();
  }, 10000);
}

async function startNextRound() {
  await ensureCurrentRound();
  startVerificationPhase(); // This now starts voting phase directly
  console.log(`🆕 Round ${currentGameState.currentRound} started!`);
  broadcastGameUpdate();
}

// API Routes

// Get game status
app.get("/api/status", async (req, res) => {
  try {
    const gameData = await getCurrentGameData();
    res.json({ success: true, ...gameData });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Verify wallet (token balance check only)
app.post("/api/verify-wallet", async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress || !isValidSolanaAddress(walletAddress)) {
      return res.status(400).json({
        success: false,
        error: "Invalid Solana wallet address",
      });
    }

    // Get token balance
    const tokenBalance = await getTokenBalance(
      walletAddress,
      CONFIG.REQUIRED_TOKEN_MINT
    );

    if (tokenBalance < CONFIG.MIN_TOKEN_BALANCE) {
      return res.status(400).json({
        success: false,
        error: `Insufficient token balance. Required: ${
          CONFIG.MIN_TOKEN_BALANCE / 1000000
        }M tokens`,
        balance: tokenBalance,
        required: CONFIG.MIN_TOKEN_BALANCE,
      });
    }

    // Save/update participant
    await Participant.findOneAndUpdate(
      { walletAddress },
      {
        walletAddress,
        tokenBalance,
        isVerified: true,
        lastVerified: new Date(),
      },
      { upsert: true }
    );

    res.json({
      success: true,
      balance: tokenBalance,
      isVerified: true,
      currentPhase: currentPhase,
      timeLeft: phaseTimeLeft,
      message: `Wallet verified! You have ${Math.floor(
        tokenBalance / 1000000
      )}M tokens. ${currentPhase === 'voting' ? 'You can now vote!' : 'Wait for next voting phase.'}`,
    });

    // Broadcast update so UI can show verification status
    broadcastGameUpdate();
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cast vote
app.post("/api/vote", async (req, res) => {
  try {
    const { walletAddress, color } = req.body;

    // Check if we're in voting phase
    if (currentPhase !== 'voting') {
      return res.status(400).json({
        success: false,
        error: `Voting is not active. Current phase: ${currentPhase}`,
        currentPhase: currentPhase,
        timeLeft: phaseTimeLeft
      });
    }

    if (!walletAddress || !color || !["red", "black"].includes(color)) {
      return res.status(400).json({
        success: false,
        error: "Invalid vote data. Choose 'red' or 'black'",
      });
    }

    // Check if wallet is verified
    const participant = await Participant.findOne({
      walletAddress,
      isVerified: true,
    });

    if (!participant) {
      return res.status(400).json({
        success: false,
        error: "Wallet not verified. Please verify your wallet first.",
      });
    }

    // Check if already voted this round
    const existingVote = await Vote.findOne({
      walletAddress,
      roundId: currentGameState.currentRound.toString(),
    });

    if (existingVote) {
      return res.status(400).json({
        success: false,
        error: "Already voted this round",
        previousVote: existingVote.color,
      });
    }

    // Get current round
    const currentRound = await Round.findOne({
      roundNumber: currentGameState.currentRound,
      status: "voting",
    });

    if (!currentRound) {
      return res.status(400).json({
        success: false,
        error: "Voting is not currently active",
      });
    }

    // Create vote
    const vote = new Vote({
      walletAddress,
      roundId: currentGameState.currentRound.toString(),
      color,
    });
    await vote.save();

    // Update round
    currentRound.votes[color] += 1;
    if (!currentRound.participants.includes(walletAddress)) {
      currentRound.participants.push(walletAddress);
    }
    await currentRound.save();


    res.json({
      success: true,
      message: `Vote cast for ${color.toUpperCase()}!`,
      voteData: {
        color: color,
        roundNumber: currentGameState.currentRound,
        timeLeft: phaseTimeLeft,
        currentPhase: currentPhase,
        votes: currentRound.votes,
        totalVoters: currentRound.participants.length,
      },
    });

    // Broadcast live vote update
    broadcastGameUpdate();
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin: Set prize amount for current round
app.post("/api/admin/set-prize", async (req, res) => {
  try {
    const { prizeAmount } = req.body;

    if (!prizeAmount || prizeAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid prize amount",
      });
    }

    const currentRound = await Round.findOne({
      roundNumber: currentGameState.currentRound,
    });

    if (currentRound) {
      currentRound.prizeAmount = prizeAmount;
      await currentRound.save();

      res.json({
        success: true,
        message: `Prize amount set to ${prizeAmount} SOL for round ${currentGameState.currentRound}`,
      });

      broadcastGameUpdate();
    } else {
      res.status(404).json({
        success: false,
        error: "Current round not found",
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin: Mark prize as paid
app.post("/api/admin/mark-paid", async (req, res) => {
  try {
    const { roundNumber } = req.body;

    const round = await Round.findOne({ roundNumber: roundNumber });

    if (!round || !round.winner) {
      return res.status(404).json({
        success: false,
        error: "Round or winner not found",
      });
    }

    // Update global stats
    currentGameState.totalPrizesGiven += round.prizeAmount;
    currentGameState.lastPrizeAmount = round.prizeAmount;
    await currentGameState.save();

    res.json({
      success: true,
      message: `Prize payment recorded for round ${roundNumber}`,
      winner: round.winner,
      amount: round.prizeAmount,
    });

    broadcastGameUpdate();
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get participants for current round
app.get("/api/participants", async (req, res) => {
  try {
    const currentRound = await Round.findOne({
      roundNumber: currentGameState.currentRound,
    });

    if (!currentRound) {
      return res.json({ success: true, participants: [], votes: [] });
    }

    const votes = await Vote.find({
      roundId: currentGameState.currentRound.toString(),
    })
      .select("walletAddress color timestamp")
      .sort({ timestamp: -1 });

    res.json({
      success: true,
      roundNumber: currentGameState.currentRound,
      participants: currentRound.participants.length,
      voteCount: {
        red: currentRound.votes.red,
        black: currentRound.votes.black,
        total: currentRound.votes.red + currentRound.votes.black,
      },
      recentVotes: votes.slice(0, 20),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get round history
app.get("/api/history", async (req, res) => {
  try {
    const rounds = await Round.find({ status: "completed" })
      .sort({ roundNumber: -1 })
      .limit(50)
      .select(
        "roundNumber votes winningColor winner prizeAmount endTime participants"
      );

    res.json({
      success: true,
      rounds: rounds,
      totalRounds: rounds.length,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "🎰 GAMBLING SERVER ONLINE",
    timestamp: new Date().toISOString(),
    currentRound: currentGameState
      ? currentGameState.currentRound
      : "Not initialized",
    currentPhase: currentPhase,
    phaseTimeLeft: phaseTimeLeft,
    connectedClients: connectedClients,
    gameType: "MANUAL_ADMIN_PAYMENTS",
  });
});

// Error handling
app.use((error, req, res, next) => {
  console.error("❌ Server error:", error);
  res.status(500).json({
    success: false,
    error: "Internal server error",
  });
});

// Start server
server.listen(PORT, async () => {
  console.log(`🎰 GAMBLING SERVER RUNNING ON PORT ${PORT}`);
  console.log(`🎯 Game Type: MANUAL ADMIN PAYMENTS`);
  console.log(`⏰ Round Duration: ${CONFIG.ROUND_DURATION / 60000} minutes`);
  console.log(`🪙 Required Token: ${CONFIG.REQUIRED_TOKEN_MINT}`);
  console.log(`💰 Min Token Balance: ${CONFIG.MIN_TOKEN_BALANCE / 1000000}M`);
  console.log(`🔌 WebSocket Server: ACTIVE`);
  console.log("🔄 Initializing game state...");

  await initializeGameState();

  console.log("✅ GAMBLING SERVER READY!");
  console.log("🎲 Players can verify wallets and vote!");
  console.log("🏆 Admin handles payments manually!");
  console.log("📡 Real-time updates via WebSockets!");
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("🛑 Shutting down server...");
  if (roundTimer) clearTimeout(roundTimer);
  await mongoose.connection.close();
  server.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("🛑 Shutting down server...");
  if (roundTimer) clearTimeout(roundTimer);
  await mongoose.connection.close();
  server.close();
  process.exit(0);
});
