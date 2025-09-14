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
    origin: ["http://localhost:5173", "http://localhost:3000","http://localhost:5502","https://redorblack.onrender.com"],
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 5500;
// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Fallback for index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


// Middleware
app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:3000","http://localhost:5502","https://redorblack.onrender.com"],
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

// MongoDB Connection
mongoose.connect(
  process.env.MONGODB_URI || "mongodb://localhost:27017/token_gamble",
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  }
).then(() => {
  console.log("✅ MongoDB connected successfully");
}).catch(err => {
  console.error("❌ MongoDB connection failed:", err);
  process.exit(1);
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
  ROUND_DURATION: parseInt(process.env.ROUND_DURATION) || 30000, // 30 seconds for testing
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
let serverTimeLeft = 600; // 10 minutes default (matches ROUND_DURATION)
let serverTimerInterval = null;

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
  const currentRound = await Round.findOne({
    roundNumber: currentGameState.currentRound,
  }).sort({ _id: -1 });

  // Use server countdown instead of calculating time
  const timeLeft = serverTimeLeft;

  return {
    gameState: {
      currentRound: currentGameState.currentRound,
      timeLeft: timeLeft,
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
  currentGameState = await GameState.findOne();
  if (!currentGameState) {
    currentGameState = new GameState({
      currentRound: 1,
      totalPrizesGiven: 0,
    });
    await currentGameState.save();
  }

  await ensureCurrentRound();
  startRoundTimer();
}

async function ensureCurrentRound() {
  // Always create a voting round if none exists
  const existingRound = await Round.findOne({
    roundNumber: currentGameState.currentRound,
  });

  if (!existingRound) {
    const newRound = new Round({
      roundNumber: currentGameState.currentRound,
      status: "voting",
      startTime: new Date(),
      prizeAmount: 0,
      votes: { red: 0, black: 0 },
      participants: []
    });
    await newRound.save();
    console.log(`🎲 NEW VOTING ROUND CREATED: ${currentGameState.currentRound}`);
  } else if (existingRound.status !== "voting") {
    // If round exists but not in voting state, reset it to voting
    existingRound.status = "voting";
    existingRound.startTime = new Date();
    existingRound.votes = { red: 0, black: 0 };
    existingRound.participants = [];
    await existingRound.save();
    console.log(`🔄 ROUND RESET TO VOTING: ${currentGameState.currentRound}`);
  }
  
  broadcastGameUpdate();
}

async function endVotingPhase() {
  const currentRound = await Round.findOne({
    roundNumber: currentGameState.currentRound,
    status: "voting",
  });

  if (!currentRound) return;

  // Step 1: Randomly select winning color (50/50 chance)
  const winningColor = Math.random() < 0.5 ? "red" : "black";
  currentRound.winningColor = winningColor;
  currentRound.status = "spinning";
  await currentRound.save();

  console.log(`⏰ Voting ended for round ${currentGameState.currentRound}`);
  console.log(`🎯 Winning Color: ${winningColor.toUpperCase()}`);

  broadcastGameUpdate();

  // Step 2: Select winner after 3 seconds
  setTimeout(async () => {
    await selectWinner();
  }, 3000);
}

async function selectWinner() {
  const currentRound = await Round.findOne({
    roundNumber: currentGameState.currentRound,
    status: "spinning",
  });

  if (!currentRound) return;

  const winningColor = currentRound.winningColor;

  // Get all voters for the winning color
  const winningVotes = await Vote.find({
    roundId: currentRound.roundNumber.toString(),
    color: winningColor,
  });

  let winner = null;
  if (winningVotes.length > 0) {
    // Randomly select winner from winning color voters
    const randomIndex = Math.floor(Math.random() * winningVotes.length);
    winner = winningVotes[randomIndex].walletAddress;
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
  console.log(`🎯 Winning Color: ${winningColor.toUpperCase()}`);
  console.log(`🏆 Winner: ${winner || "No Winner"}`);
  console.log(`📊 Total Votes - Red: ${currentRound.votes.red}, Black: ${currentRound.votes.black}`);

  broadcastGameUpdate();

  // Start next round after 5 seconds
  setTimeout(async () => {
    await startNextRound();
  }, 5000);
}

async function startNextRound() {
  await ensureCurrentRound();
  startRoundTimer();
  console.log(`🆕 Round ${currentGameState.currentRound} started!`);
  broadcastGameUpdate();
}

function startRoundTimer() {
  // Clear existing timers
  if (roundTimer) {
    clearTimeout(roundTimer);
  }
  if (serverTimerInterval) {
    clearInterval(serverTimerInterval);
  }

  // Reset server countdown
  serverTimeLeft = CONFIG.ROUND_DURATION / 1000; // Convert to seconds
  
  // Start server countdown
  serverTimerInterval = setInterval(() => {
    serverTimeLeft = Math.max(0, serverTimeLeft - 1);
    
    // Debug logging
    if (serverTimeLeft % 60 === 0) {
      console.log(`⏰ Time remaining: ${serverTimeLeft} seconds`);
    }
    
    // Broadcast update every 5 seconds
    if (serverTimeLeft % 5 === 0) {
      broadcastGameUpdate();
    }
    
    // End voting when time reaches 0
    if (serverTimeLeft <= 0) {
      console.log(`⏰ Timer reached 0, ending voting phase`);
      clearInterval(serverTimerInterval);
      endVotingPhase();
    }
  }, 1000);

  console.log(`⏰ Voting started: ${serverTimeLeft} seconds`);
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
      message: `Wallet verified! You have ${Math.floor(
        tokenBalance / 1000000
      )}M tokens.`,
    });

    // Don't broadcast game update for verification - it doesn't change game state
    // broadcastGameUpdate();
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cast vote
app.post("/api/vote", async (req, res) => {
  try {
    const { walletAddress, color } = req.body;

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

    const timeLeft = Math.max(
      0,
      Math.floor((currentGameState.nextRoundStartTime - new Date()) / 1000)
    );

    res.json({
      success: true,
      message: `Vote cast for ${color.toUpperCase()}!`,
      voteData: {
        color: color,
        roundNumber: currentGameState.currentRound,
        timeLeft: timeLeft,
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
