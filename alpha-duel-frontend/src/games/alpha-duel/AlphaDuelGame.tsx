import { useState, useEffect, useRef } from 'react';
import { AlphaDuelService } from './alphaDuelService';
import { requestCache, createCacheKey } from '@/utils/requestCache';
import { useWallet } from '@/hooks/useWallet';
import { ALPHA_DUEL_CONTRACT } from '@/utils/constants';
import { sha256 } from '@noble/hashes/sha2.js';
import { getFundedSimulationSourceAddress } from '@/utils/simulationUtils';
import { devWalletService, DevWalletService } from '@/services/devWalletService';
import type { Game } from './bindings';
import { Clipboard } from "lucide-react"; 


// Word pool with 50+ words, all > 3 letters
const WORD_POOL = [
  'APPLE','BANANA','ORANGE','GRAPE','MANGO','PEACH','LEMON','CHERRY','PEAR','PLUM',
  'KIWI','FIG','DATE','LIME','APRICOT','PAPAYA','GUAVA','PINEAPPLE','COCONUT','BLUEBERRY',
  'STRAWBERRY','RASPBERRY','BLACKBERRY','WATERMELON','CANTALOUPE','HONEYDEW','NECTARINE','TANGERINE','POMEGRANATE','PASSIONFRUIT',
  'DRAGONFRUIT','LYCHEE','JACKFRUIT','CRANBERRY','MULBERRY','FIGS','DATEFRUIT','OLIVE','QUINCE','KUMQUAT',
  'AVOCADO','MANDARIN','PEPPERMINT','CLEMENTINE','GRAPEFRUIT','STARFRUIT','BILBERRY','GOOSEBERRY','ELDERBERRY','SATSUMA'
];

const getHiddenWord = (id: number): string => {
  if (id < 0 || id >= WORD_POOL.length) {
    throw new Error(`Invalid hidden_word_id: ${id}`);
  }
  return WORD_POOL[id];
};

function computeCommitment(guess: number[], salt: string): Uint8Array {
  const data = new TextEncoder().encode(
    guess.join(",") + "|" + salt
  );
  return sha256(data); // 32 bytes
}



const numberToLetter = (num: number): string => {
  if (num < 1 || num > 26) throw new Error('numberToLetter: number must be 1-26');
  return String.fromCharCode(num + 64); // 1 -> A
};

// Utility to pick a random word
const getRandomWord = () => WORD_POOL[Math.floor(Math.random() * WORD_POOL.length)];

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const createRandomSessionId = (): number => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    let value = 0;
    const buffer = new Uint32Array(1);
    while (value === 0) {
      crypto.getRandomValues(buffer);
      value = buffer[0];
    }
    return value;
  }

  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
};

// Create service instance with the contract ID
const alphaDuelService = new AlphaDuelService(ALPHA_DUEL_CONTRACT);

interface AlphaDuelGameProps {
  userAddress: string;
  currentEpoch: number;
  availablePoints: bigint;
  initialXDR?: string | null;
  initialSessionId?: number | null;
  onStandingsRefresh: () => void;
  onGameComplete: () => void;
}

export function AlphaDuelGame({
  userAddress,
  availablePoints,
  initialXDR,
  initialSessionId,
  onStandingsRefresh,
  onGameComplete
}: AlphaDuelGameProps) {
  // Hidden word picked from pool per session
  const [hiddenWord, setHiddenWord] = useState<string>(() => getRandomWord());
  const DEFAULT_POINTS = '0.1';
  const { getContractSigner, walletType } = useWallet();
  // Use a random session ID that fits in u32 (avoid 0 because UI validation treats <=0 as invalid)
  const [sessionId, setSessionId] = useState<number>(() => createRandomSessionId());
  const [player1Address, setPlayer1Address] = useState(userAddress);
  const [player1Points, setPlayer1Points] = useState(DEFAULT_POINTS);
  const [guess, setGuess] = useState<string[]>([]);
  const [numericGuess, setNumericGuess] = useState<number | null>(null);
  const [gameState, setGameState] = useState<Game | null>(null);
  const [loading, setLoading] = useState(false);
  const [quickstartLoading, setQuickstartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [gamePhase, setGamePhase] = useState<'create' | 'guess' | 'reveal' | 'complete'>('create');
  const [createMode, setCreateMode] = useState<'create' | 'import' | 'load'>('create');
  const [exportedAuthEntryXDR, setExportedAuthEntryXDR] = useState<string | null>(null);
  const [importAuthEntryXDR, setImportAuthEntryXDR] = useState('');
  const [importSessionId, setImportSessionId] = useState('');
  const [importPlayer1, setImportPlayer1] = useState('');
  const [importPlayer1Points, setImportPlayer1Points] = useState('');
  const [importPlayer2Points, setImportPlayer2Points] = useState(DEFAULT_POINTS);
  const [loadSessionId, setLoadSessionId] = useState('');
  const [authEntryCopied, setAuthEntryCopied] = useState(false);
  const [shareUrlCopied, setShareUrlCopied] = useState(false);
  const [xdrParsing, setXdrParsing] = useState(false);
  const [xdrParseError, setXdrParseError] = useState<string | null>(null);
  const [xdrParseSuccess, setXdrParseSuccess] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [player1Guess, setPlayer1Guess] = useState<string[]>([]);
  const [player2Guess, setPlayer2Guess] = useState<string[]>([]);
  const [player1GuessNumbers, setPlayer1GuessNumbers] = useState<number[]>([]);
  const [player2GuessNumbers, setPlayer2GuessNumbers] = useState<number[]>([]);
  const [proofHex, setProofHex] = useState("");
  const [publicInputsHex, setPublicInputsHex] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [showHexOutput, setShowHexOutput] = useState(false);
  const [proofLoading, setProofLoading] = useState(false);
  const [winnerAddr, setWinnerAddr] = useState<string | undefined>(undefined);


  

  useEffect(() => {
    setPlayer1Address(userAddress);
  }, [userAddress]);

  useEffect(() => {
    if (createMode === 'import' && !importPlayer2Points.trim()) {
      setImportPlayer2Points(DEFAULT_POINTS);
    }
  }, [createMode, importPlayer2Points]);

  const POINTS_DECIMALS = 7;
  const isBusy = loading || quickstartLoading;
  const actionLock = useRef(false);
  const quickstartAvailable = walletType === 'dev'
    && DevWalletService.isDevModeAvailable()
    && DevWalletService.isPlayerAvailable(1)
    && DevWalletService.isPlayerAvailable(2);


  const runAction = async (action: () => Promise<void>) => {
    if (actionLock.current || isBusy) {
      return;
    }
    actionLock.current = true;
    try {
      await action();
    } finally {
      actionLock.current = false;
    }
  };

  const handleCopy = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 1500); // show temporary feedback
  };


  const handleLetterClick = async (player: number, letter: string) => {
  if (actionLock.current) return;

  if (player === 1) {
    if (!player1Guess.includes(letter) && player1Guess.length < 3) {
      const updated = [...player1Guess, letter];
      setPlayer1Guess(updated);
      const updatedNumbers = updated.map(letterToNumber);
      //setPlayer1GuessNumbers(updatedNumbers);

      // send to backend for sync
      await alphaDuelService.commitGuessToBackend(sessionId, 1, updatedNumbers);
    }
  } else {
    if (!player2Guess.includes(letter) && player2Guess.length < 3) {
      const updated = [...player2Guess, letter];
      setPlayer2Guess(updated);
      const updatedNumbers = updated.map(letterToNumber);
      //setPlayer2GuessNumbers(updatedNumbers);

      // send to backend for sync
      await alphaDuelService.commitGuessToBackend(sessionId, 2, updatedNumbers);
    }
  }
};


  const handleEndGame = async () => {
  try {
    setLoading(true);
    setError(null);

    const signer = getContractSigner();
    // 1️⃣ If current game has winner, finalize on-chain
    if (gameState?.winner) {
      onGameComplete();
       

      await alphaDuelService.endGame(
        sessionId,
        userAddress, // caller must sign
        signer
      );
    }

    // 2️⃣ Reset frontend state AFTER successful settlement
    actionLock.current = false;
    setGamePhase('create');
    setSessionId(createRandomSessionId());
    setGameState(null);
    setGuess([]);
    setNumericGuess(null);
    setQuickstartLoading(false);
    setStatus(null);
    setSuccess(null);
    setCreateMode('create');
    setExportedAuthEntryXDR(null);
    setImportAuthEntryXDR('');
    setImportSessionId('');
    setImportPlayer1('');
    setImportPlayer1Points('');
    setImportPlayer2Points(DEFAULT_POINTS);
    setLoadSessionId('');
    setAuthEntryCopied(false);
    setShareUrlCopied(false);
    setXdrParsing(false);
    setXdrParseError(null);
    setXdrParseSuccess(false);
    setPlayer1Address(userAddress);
    setPlayer1Points(DEFAULT_POINTS);

  } catch (err: any) {
    setError(err.message || "Failed to end previous game");
  } finally {
    setLoading(false);
  }
};


  const parsePoints = (value: string): bigint | null => {
    try {
      const cleaned = value.replace(/[^\d.]/g, '');
      if (!cleaned || cleaned === '.') return null;

      const [whole = '0', fraction = ''] = cleaned.split('.');
      const paddedFraction = fraction.padEnd(POINTS_DECIMALS, '0').slice(0, POINTS_DECIMALS);
      return BigInt(whole + paddedFraction);
    } catch {
      return null;
    }
  };

  const loadGameState = async () => {
    try {
      // Always fetch latest game state to avoid stale cached results after transactions.
      const game = await alphaDuelService.getGame(sessionId);
      setGameState(game);

      // Determine game phase based on state
      if (game && game.winner !== null && game.winner !== undefined) {
        setGamePhase('complete');
      } else if (game && game.player1_guess_commitment !== null && game.player1_guess_commitment !== undefined &&
                 game.player2_guess_commitment !== null && game.player2_guess_commitment !== undefined) {
        setGamePhase('reveal');
      } else {
        setGamePhase('guess');
      }
    } catch (err) {
      // Game doesn't exist yet
      setGameState(null);
    }
  };



  useEffect(() => {
    if (gamePhase !== 'create') {
      loadGameState();
      const interval = setInterval(loadGameState, 5000); // Poll every 5 seconds
      return () => clearInterval(interval);
    }
  }, [sessionId, gamePhase]);

  // Auto-refresh standings when game completes (for passive player who didn't call reveal_winner)
  useEffect(() => {
    if (gamePhase === 'complete' && gameState?.winner) {
      console.log('Game completed! Refreshing standings and dashboard data...');
      onStandingsRefresh(); // Refresh standings and available points; don't call onGameComplete() here or it will close the game!
    }
  }, [gamePhase, gameState?.winner]);

  // Handle initial values from URL deep linking or props
  // Expected URL formats:
  //   - With auth entry: ?game=alpha-duel&auth=AAAA... (Session ID, P1 address, P1 points parsed from auth entry)
  //   - With session ID: ?game=alpha-duel&session-id=123 (Load existing game)
  // Note: GamesCatalog cleans URL params, so we prioritize props over URL
  useEffect(() => {
    // Priority 1: Check initialXDR prop (from GamesCatalog after URL cleanup)
    if (initialXDR) {
      console.log('[Deep Link] Using initialXDR prop from GamesCatalog');

      try {
        const parsed = alphaDuelService.parseAuthEntry(initialXDR);
        const sessionId = parsed.sessionId;

        console.log('[Deep Link] Parsed session ID from initialXDR:', sessionId);

        // Check if game already exists (both players have signed)
        alphaDuelService.getGame(sessionId)
          .then((game) => {
            if (game) {
              // Game exists! Load it directly instead of going to import mode
              console.log('[Deep Link] Game already exists, loading directly to guess phase');
              console.log('[Deep Link] Game data:', game);

              // Auto-load the game - bypass create phase entirely
              setGameState(game);
              setGamePhase('guess');
              setSessionId(sessionId); // Set session ID for the game
            } else {
              // Game doesn't exist yet, go to import mode
              console.log('[Deep Link] Game not found, entering import mode');
              setCreateMode('import');
              setImportAuthEntryXDR(initialXDR);
              setImportSessionId(sessionId.toString());
              setImportPlayer1(parsed.player1);
              setImportPlayer1Points((Number(parsed.player1Points) / 10_000_000).toString());
              setImportPlayer2Points('0.1');
            }
          })
          .catch((err) => {
            console.error('[Deep Link] Error checking game existence:', err);
            console.error('[Deep Link] Error details:', {
              message: err?.message,
              stack: err?.stack,
              sessionId: sessionId,
            });
            // If we can't check, default to import mode
            setCreateMode('import');
            setImportAuthEntryXDR(initialXDR);
            setImportSessionId(parsed.sessionId.toString());
            setImportPlayer1(parsed.player1);
            setImportPlayer1Points((Number(parsed.player1Points) / 10_000_000).toString());
            setImportPlayer2Points('0.1');
          });
      } catch (err) {
        console.log('[Deep Link] Failed to parse initialXDR, will retry on import');
        setCreateMode('import');
        setImportAuthEntryXDR(initialXDR);
        setImportPlayer2Points('0.1');
      }
      return; // Exit early - we processed initialXDR
    }

    // Priority 2: Check URL parameters (for direct navigation without GamesCatalog)
    const urlParams = new URLSearchParams(window.location.search);
    const authEntry = urlParams.get('auth');
    const urlSessionId = urlParams.get('session-id');

    if (authEntry) {
      // Simplified URL format - only auth entry is needed
      // Session ID, Player 1 address, and points are parsed from auth entry
      console.log('[Deep Link] Auto-populating game from URL with auth entry');

      // Try to parse auth entry to get session ID
      try {
        const parsed = alphaDuelService.parseAuthEntry(authEntry);
        const sessionId = parsed.sessionId;

        console.log('[Deep Link] Parsed session ID from URL auth entry:', sessionId);

        // Check if game already exists (both players have signed)
        alphaDuelService.getGame(sessionId)
          .then((game) => {
            if (game) {
              // Game exists! Load it directly instead of going to import mode
              console.log('[Deep Link] Game already exists (URL), loading directly to guess phase');
              console.log('[Deep Link] Game data:', game);

              // Auto-load the game - bypass create phase entirely
              setGameState(game);
              setGamePhase('guess');
              setSessionId(sessionId); // Set session ID for the game
            } else {
              // Game doesn't exist yet, go to import mode
              console.log('[Deep Link] Game not found (URL), entering import mode');
              setCreateMode('import');
              setImportAuthEntryXDR(authEntry);
              setImportSessionId(sessionId.toString());
              setImportPlayer1(parsed.player1);
              setImportPlayer1Points((Number(parsed.player1Points) / 10_000_000).toString());
              setImportPlayer2Points('0.1');
            }
          })
          .catch((err) => {
            console.error('[Deep Link] Error checking game existence (URL):', err);
            console.error('[Deep Link] Error details:', {
              message: err?.message,
              stack: err?.stack,
              sessionId: sessionId,
            });
            // If we can't check, default to import mode
            setCreateMode('import');
            setImportAuthEntryXDR(authEntry);
            setImportSessionId(parsed.sessionId.toString());
            setImportPlayer1(parsed.player1);
            setImportPlayer1Points((Number(parsed.player1Points) / 10_000_000).toString());
            setImportPlayer2Points('0.1');
          });
      } catch (err) {
        console.log('[Deep Link] Failed to parse auth entry from URL, will retry on import');
        setCreateMode('import');
        setImportAuthEntryXDR(authEntry);
        setImportPlayer2Points('0.1');
      }
    } else if (urlSessionId) {
      // Load existing game by session ID
      console.log('[Deep Link] Auto-populating game from URL with session ID');
      setCreateMode('load');
      setLoadSessionId(urlSessionId);
    } else if (initialSessionId !== null && initialSessionId !== undefined) {
      console.log('[Deep Link] Auto-populating session ID from prop:', initialSessionId);
      setCreateMode('load');
      setLoadSessionId(initialSessionId.toString());
    }
  }, [initialXDR, initialSessionId]);

  // Auto-parse Auth Entry XDR when pasted
  useEffect(() => {
    // Only parse if in import mode and XDR is not empty
    if (createMode !== 'import' || !importAuthEntryXDR.trim()) {
      // Reset parse states when XDR is cleared
      if (!importAuthEntryXDR.trim()) {
        setXdrParsing(false);
        setXdrParseError(null);
        setXdrParseSuccess(false);
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
      }
      return;
    }

    // Auto-parse the XDR
    const parseXDR = async () => {
      setXdrParsing(true);
      setXdrParseError(null);
      setXdrParseSuccess(false);

      try {
        console.log('[Auto-Parse] Parsing auth entry XDR...');
        const gameParams = alphaDuelService.parseAuthEntry(importAuthEntryXDR.trim());

        // Check if user is trying to import their own auth entry (self-play prevention)
        if (gameParams.player1 === userAddress) {
          throw new Error('You cannot play against yourself. This auth entry was created by you (Player 1).');
        }

        // Successfully parsed - auto-fill fields
        setImportSessionId(gameParams.sessionId.toString());
        setImportPlayer1(gameParams.player1);
        setImportPlayer1Points((Number(gameParams.player1Points) / 10_000_000).toString());
        setXdrParseSuccess(true);
        console.log('[Auto-Parse] Successfully parsed auth entry:', {
          sessionId: gameParams.sessionId,
          player1: gameParams.player1,
          player1Points: (Number(gameParams.player1Points) / 10_000_000).toString(),
        });
      } catch (err) {
        console.error('[Auto-Parse] Failed to parse auth entry:', err);
        const errorMsg = err instanceof Error ? err.message : 'Invalid auth entry XDR';
        setXdrParseError(errorMsg);
        // Clear auto-filled fields on error
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
      } finally {
        setXdrParsing(false);
      }
    };

    // Debounce parsing to avoid parsing on every keystroke
    const timeoutId = setTimeout(parseXDR, 500);
    return () => clearTimeout(timeoutId);
  }, [importAuthEntryXDR, createMode, userAddress]);


  const handlePrepareTransaction = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);

        const p1Points = parsePoints(player1Points);

        if (!p1Points || p1Points <= 0n) {
          throw new Error('Enter a valid points amount');
        }

        const signer = getContractSigner();

        // Use placeholder values for Player 2 (they'll rebuild with their own values).
        // We still need a real, funded account as the transaction source for build/simulation.
        const placeholderPlayer2Address = await getFundedSimulationSourceAddress([player1Address, userAddress]);
        const placeholderP2Points = p1Points; // Same as P1 for simulation

        console.log('Preparing transaction for Player 1 to sign...');
        console.log('Using placeholder Player 2 values for simulation only');
        const authEntryXDR = await alphaDuelService.prepareStartGame(
          sessionId,
          player1Address,
          placeholderPlayer2Address,
          p1Points,
          placeholderP2Points,
          signer
        );

        console.log('Transaction prepared successfully! Player 1 has signed their auth entry.');
        setExportedAuthEntryXDR(authEntryXDR);
        setSuccess('Auth entry signed! Copy the auth entry XDR or share URL below and send it to Player 2. Waiting for them to sign...');

        // Start polling for the game to be created by Player 2
        const pollInterval = setInterval(async () => {
          try {
            // Try to load the game
            const game = await alphaDuelService.getGame(sessionId);
            if (game) {
              console.log('Game found! Player 2 has finalized the transaction. Transitioning to guess phase...');
              clearInterval(pollInterval);

              // Update game state
              setGameState(game);
              setExportedAuthEntryXDR(null);
              setSuccess('Game created! Player 2 has signed and submitted.');
              setGamePhase('guess');

              // Refresh dashboard to show updated available points (locked in game)
              onStandingsRefresh();

              // Clear success message after 2 seconds
              setTimeout(() => setSuccess(null), 2000);
            } else {
              console.log('Game not found yet, continuing to poll...');
            }
          } catch (err) {
            // Game doesn't exist yet, keep polling
            console.log('Polling for game creation...', err instanceof Error ? err.message : 'checking');
          }
        }, 3000); // Poll every 3 seconds

        // Stop polling after 5 minutes
        setTimeout(() => {
          clearInterval(pollInterval);
          console.log('Stopped polling after 5 minutes');
        }, 300000);
      } catch (err) {
        console.error('Prepare transaction error:', err);
        // Extract detailed error message
        let errorMessage = 'Failed to prepare transaction';
        if (err instanceof Error) {
          errorMessage = err.message;

          // Check for common errors
          if (err.message.includes('insufficient')) {
            errorMessage = `Insufficient points: ${err.message}. Make sure you have enough points for this game.`;
          } else if (err.message.includes('auth')) {
            errorMessage = `Authorization failed: ${err.message}. Check your wallet connection.`;
          }
        }

        setError(errorMessage);

        // Keep the component in 'create' phase so user can see the error and retry
      } finally {
        setLoading(false);
      }
    });
  };

  const handleQuickStart = async () => {
    await runAction(async () => {
      try {
        setQuickstartLoading(true);
        setError(null);
        setSuccess(null);
        if (walletType !== 'dev') {
          throw new Error('Quickstart only works with dev wallets in the Games Library.');
        }

        if (!DevWalletService.isDevModeAvailable() || !DevWalletService.isPlayerAvailable(1) || !DevWalletService.isPlayerAvailable(2)) {
          throw new Error('Quickstart requires both dev wallets. Run "bun run setup" and connect a dev wallet.');
        }

        const p1Points = parsePoints(player1Points);
        if (!p1Points || p1Points <= 0n) {
          throw new Error('Enter a valid points amount');
        }

        const originalPlayer = devWalletService.getCurrentPlayer();
        let player1AddressQuickstart = '';
        let player2AddressQuickstart = '';
        let player1Signer: ReturnType<typeof devWalletService.getSigner> | null = null;
        let player2Signer: ReturnType<typeof devWalletService.getSigner> | null = null;

        try {
          await devWalletService.initPlayer(1);
          player1AddressQuickstart = devWalletService.getPublicKey();
          player1Signer = devWalletService.getSigner();

          await devWalletService.initPlayer(2);
          player2AddressQuickstart = devWalletService.getPublicKey();
          player2Signer = devWalletService.getSigner();
        } finally {
          if (originalPlayer) {
            await devWalletService.initPlayer(originalPlayer);
          }
        }

        if (!player1Signer || !player2Signer) {
          throw new Error('Quickstart failed to initialize dev wallet signers.');
        }

        if (player1AddressQuickstart === player2AddressQuickstart) {
          throw new Error('Quickstart requires two different dev wallets.');
        }

        const quickstartSessionId = createRandomSessionId();
        setSessionId(quickstartSessionId);
        setPlayer1Address(player1AddressQuickstart);
        setCreateMode('create');
        setExportedAuthEntryXDR(null);
        setImportAuthEntryXDR('');
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
        setImportPlayer2Points(DEFAULT_POINTS);
        setLoadSessionId('');

        const placeholderPlayer2Address = await getFundedSimulationSourceAddress([
          player1AddressQuickstart,
          player2AddressQuickstart,
        ]);

        const authEntryXDR = await alphaDuelService.prepareStartGame(
          quickstartSessionId,
          player1AddressQuickstart,
          placeholderPlayer2Address,
          p1Points,
          p1Points,
          player1Signer
        );

        const fullySignedTxXDR = await alphaDuelService.importAndSignAuthEntry(
          authEntryXDR,
          player2AddressQuickstart,
          p1Points,
          player2Signer
        );

        await alphaDuelService.finalizeStartGame(
          fullySignedTxXDR,
          player2AddressQuickstart,
          player2Signer
        );

        try {
          const game = await alphaDuelService.getGame(quickstartSessionId);
          setGameState(game);
        } catch (err) {
          console.log('Quickstart game not available yet:', err);
        }
        setGamePhase('guess');
        onStandingsRefresh();
        setSuccess('Quickstart complete! Both players signed and the game is ready.');
        setTimeout(() => setSuccess(null), 2000);
      } catch (err) {
        console.error('Quickstart error:', err);
        setError(err instanceof Error ? err.message : 'Quickstart failed');
      } finally {
        setQuickstartLoading(false);
      }
    });
  };

  const handleImportTransaction = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);
        // Validate required inputs (only auth entry and player 2 points)
        if (!importAuthEntryXDR.trim()) {
          throw new Error('Enter auth entry XDR from Player 1');
        }
        if (!importPlayer2Points.trim()) {
          throw new Error('Enter your points amount (Player 2)');
        }

        // Parse Player 2's points
        const p2Points = parsePoints(importPlayer2Points);
        if (!p2Points || p2Points <= 0n) {
          throw new Error('Invalid Player 2 points');
        }

        // Parse auth entry to extract game parameters
        // The auth entry contains: session_id, player1, player1_points
        console.log('Parsing auth entry to extract game parameters...');
        const gameParams = alphaDuelService.parseAuthEntry(importAuthEntryXDR.trim());

        console.log('Extracted from auth entry:', {
          sessionId: gameParams.sessionId,
          player1: gameParams.player1,
          player1Points: gameParams.player1Points.toString(),
        });

        // Auto-populate read-only fields from parsed auth entry (for display)
        setImportSessionId(gameParams.sessionId.toString());
        setImportPlayer1(gameParams.player1);
        setImportPlayer1Points((Number(gameParams.player1Points) / 10_000_000).toString());

        // Verify the user is Player 2 (prevent self-play)
        if (gameParams.player1 === userAddress) {
          throw new Error('Invalid game: You cannot play against yourself (you are Player 1 in this auth entry)');
        }

        // Additional validation: Ensure Player 2 address is different from Player 1
        // (In case user manually edits the Player 2 field)
        if (userAddress === gameParams.player1) {
          throw new Error('Cannot play against yourself. Player 2 must be different from Player 1.');
        }

        const signer = getContractSigner();

        // Step 1: Import Player 1's signed auth entry and rebuild transaction
        // New simplified API - only needs: auth entry, player 2 address, player 2 points
        console.log('Importing Player 1 auth entry and rebuilding transaction...');
        const fullySignedTxXDR = await alphaDuelService.importAndSignAuthEntry(
          importAuthEntryXDR.trim(),
          userAddress, // Player 2 address (current user)
          p2Points,
          signer
        );

        // Step 2: Player 2 finalizes and submits (they are the transaction source)
        console.log('Simulating and submitting transaction...');
        await alphaDuelService.finalizeStartGame(
          fullySignedTxXDR,
          userAddress,
          signer
        );

        // If we get here, transaction succeeded! Now update state.
        console.log('Transaction submitted successfully! Updating state...');
        setSessionId(gameParams.sessionId);
        setSuccess('Game created successfully! Both players signed.');
        setGamePhase('guess');

        // Clear import fields
        setImportAuthEntryXDR('');
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
        setImportPlayer2Points(DEFAULT_POINTS);

        // Load the newly created game state
        await loadGameState();

        // Refresh dashboard to show updated available points (locked in game)
        onStandingsRefresh();

        // Clear success message after 2 seconds
        setTimeout(() => setSuccess(null), 2000);
      } catch (err) {
        console.error('Import transaction error:', err);
        // Extract detailed error message if available
        let errorMessage = 'Failed to import and sign transaction';
        if (err instanceof Error) {
          errorMessage = err.message;

          // Check for common Soroban errors
          if (err.message.includes('simulation failed')) {
            errorMessage = `Simulation failed: ${err.message}. Check that you have enough Points and the game parameters are correct.`;
          } else if (err.message.includes('transaction failed')) {
            errorMessage = `Transaction failed: ${err.message}. The game could not be created on the blockchain.`;
          }
        }

        setError(errorMessage);

        // Keep the component in 'create' phase so user can see the error and retry
        // Don't change gamePhase or clear any fields - let the user see what went wrong
      } finally {
        setLoading(false);
      }
    });
  };

  const handleLoadExistingGame = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);
        const parsedSessionId = parseInt(loadSessionId.trim());
        if (isNaN(parsedSessionId) || parsedSessionId <= 0) {
          throw new Error('Enter a valid session ID');
        }

        // Try to load the game (use cache to prevent duplicate calls)
        const game = await requestCache.dedupe(
          createCacheKey('game-state', parsedSessionId),
          () => alphaDuelService.getGame(parsedSessionId),
          5000
        );

        // Verify game exists and user is one of the players
        if (!game) {
          throw new Error('Game not found');
        }

        if (game.player1 !== userAddress && game.player2 !== userAddress) {
          throw new Error('You are not a player in this game');
        }

        // Load successful - update session ID and transition to game
        setSessionId(parsedSessionId);
        setGameState(game);
        setLoadSessionId('');

        // Determine game phase based on game state
        if (game.winner !== null && game.winner !== undefined) {
          // Game is complete - show reveal phase with winner
          setGamePhase('reveal');
          const isWinner = game.winner === userAddress;
          setSuccess(isWinner ? '🎉 You won this game!' : 'Game complete. Winner revealed.');
        } else if (game.player1_guess_commitment !== null && game.player1_guess_commitment !== undefined &&
            game.player2_guess_commitment !== null && game.player2_guess_commitment !== undefined) {
          // Both players guessed, waiting for reveal
          setGamePhase('reveal');
          setSuccess('Game loaded! Both players have guessed. You can reveal the winner.');
        } else {
          // Still in guessing phase
          setGamePhase('guess');
          setSuccess('Game loaded! Make your guess.');
        }

        // Clear success message after 2 seconds
        setTimeout(() => setSuccess(null), 2000);
      } catch (err) {
        console.error('Load game error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load game');
      } finally {
        setLoading(false);
      }
    });
  };

  const copyAuthEntryToClipboard = async () => {
    if (exportedAuthEntryXDR) {
      try {
        await navigator.clipboard.writeText(exportedAuthEntryXDR);
        setAuthEntryCopied(true);
        setTimeout(() => setAuthEntryCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy auth entry XDR:', err);
        setError('Failed to copy to clipboard');
      }
    }
  };

  const copyShareGameUrlWithAuthEntry = async () => {
    if (exportedAuthEntryXDR) {
      try {
        // Build URL with only Player 1's info and auth entry
        // Player 2 will specify their own points when they import
        const params = new URLSearchParams({
          'game': 'alpha-duel',
          'auth': exportedAuthEntryXDR,
        });

        const shareUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
        await navigator.clipboard.writeText(shareUrl);
        setShareUrlCopied(true);
        setTimeout(() => setShareUrlCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy share URL:', err);
        setError('Failed to copy to clipboard');
      }
    }
  };

  const copyShareGameUrlWithSessionId = async () => {
    if (loadSessionId) {
      try {
        const shareUrl = `${window.location.origin}${window.location.pathname}?game=alpha-duel&session-id=${loadSessionId}`;
        await navigator.clipboard.writeText(shareUrl);
        setShareUrlCopied(true);
        setTimeout(() => setShareUrlCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy share URL:', err);
        setError('Failed to copy to clipboard');
      }
    }
  };
  


const handleRevealWinner = async () => {
  await runAction(async () => {
    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      const signer = getContractSigner();
      await alphaDuelService.revealWinner(sessionId, userAddress, signer);

      if (!gameState) throw new Error("Game state not found");

      // 1️⃣ Get guesses (unwrap Option)
      const player1GuessNums: number[] = gameState.player1_guess || [];
      const player2GuessNums: number[] = gameState.player2_guess || [];

      // 2️⃣ Get the hidden word
      const hiddenWord = getHiddenWord(gameState.hidden_word_id);
      const hiddenWordLetters = hiddenWord.split('').map(l => l.toUpperCase());

      // 3️⃣ Convert guesses to letters matching contract encoding (0 = A)
      const numberToLetter = (num: number) =>
        String.fromCharCode(num + 65); // 0 -> A, 1 -> B, ..., 25 -> Z

      
      const player1Letters = player1GuessNums.map(n => numberToLetter(n));
      const player2Letters = player2GuessNums.map(n => numberToLetter(n));

      // 4️⃣ Count correct letters
      const countCorrect = (letters: string[]) =>
        letters.filter(letter => hiddenWordLetters.includes(letter)).length;

      const p1Correct = countCorrect(player1Letters);
      const p2Correct = countCorrect(player2Letters);

      console.log("Hidden word:", hiddenWordLetters.join(''));
      console.log("Player1 letters:", player1Letters.join(''), "Correct:", p1Correct);
      console.log("Player2 letters:", player2Letters.join(''), "Correct:", p2Correct);

      // 5️⃣ Update game state from contract
      const updatedGame = await alphaDuelService.getGame(sessionId);
      if (!updatedGame) throw new Error('Failed to retrieve updated game state');
      setGameState(updatedGame);

      // 6️⃣ Determine winner for frontend display
      const winner = updatedGame.winner;
      console.log("Winner from contract:", winner);

      setGamePhase('complete');

      // 7️⃣ Show messages
      if (!winner) {
        setSuccess('🎲 It’s a tie! No winner.');
      } else {
        setSuccess(
          winner === userAddress
            ? `🎉 You won! ${winner.slice(0, 8)}...${winner.slice(-4)}`
            : `Game complete!}`
        );
      }

      // 8️⃣ Refresh standings
      onStandingsRefresh();

    } catch (err) {
      console.error('Reveal winner error:', err);
      setError(err instanceof Error ? err.message : 'Failed to reveal winner');
    } finally {
      setLoading(false);
    }
  });
};

interface EncodedHiddenWord {
  encodedArray: number[];
}

const encodeHiddenWord = (hiddenWord: string): number[] => {
  const hiddenNumbers: number[] = hiddenWord
    .toUpperCase()
    .split("")
    .map(letterToNumber); // A=0, B=1, ... Z=25

  // Pad with 255 to make length 12
  while (hiddenNumbers.length < 12) {
    hiddenNumbers.push(255);
  }

  // Truncate if longer than 12 (just in case)
  return hiddenNumbers.slice(0, 12);
};

const handleRevealWinnerWithProof = async () => {
  await runAction(async () => {
  try {
    console.log("🔍 Preparing to reveal winner...");
      setLoading(true);
      setError(null);
      setSuccess(null);

    const signer = getContractSigner();

    const hiddenNumbers = encodeHiddenWord(getHiddenWord(gameState?.hidden_word_id || 0));

    // 5️⃣ Call the contract
    const result = await alphaDuelService.revealWinnerWithProof(
      sessionId,
      userAddress,
      hiddenNumbers,
      getHiddenWord(gameState?.hidden_word_id || 0).length,
      signer
    );

    if (!gameState) throw new Error("Game state not found");
    
    // 5️⃣ Update game state from contract
      const updatedGame = await alphaDuelService.getGame(sessionId);
      if (!updatedGame) throw new Error('Failed to retrieve updated game state');
      setGameState(updatedGame);

      // 6️⃣ Determine winner for frontend display
      const winner = updatedGame.winner;
      setWinnerAddr(updatedGame.winner);
      console.log("Winner from contract:", winner);

      setGamePhase('complete');

      // 7️⃣ Show messages
      if (!winner) {
        setSuccess('🎲 It’s a tie! No winner.');
      } else {
        setSuccess(
          winner === userAddress
            ? "🎉 You won!"
            : "Game complete!"
        );
      }

      // ✅ Store proof + public inputs for Complete Phase display
      setProofHex(result.proof);
      setPublicInputsHex(result.publicInputs);
      setPlayer1GuessNumbers(result.player1);
      setPlayer2GuessNumbers(result.player2);

      // 8️⃣ Refresh standings
      onStandingsRefresh();

  } catch (err) {
    console.error("❌ Failed to reveal winner with proof:", err);
    throw err;
  }
})
}


  const isPlayer1 = gameState && gameState.player1 === userAddress;
  const isPlayer2 = gameState && gameState.player2 === userAddress;
  const hasGuessed: boolean = isPlayer1
  ? !!gameState?.player1_guess_commitment
  : isPlayer2
  ? !!gameState?.player2_guess_commitment
  : false;

 const letterToNumber = (letter: string) => {
  const charCode = letter.toUpperCase().charCodeAt(0);
  return charCode - 65; // A->0, B->1, ..., Z->25
};

const numberToLetter = (num: number): string => {
  if (num < 0 || num > 25) {
    throw new Error("numberToLetter: number must be between 0 and 25");
  }

  return String.fromCharCode(num + 65); 
  // 0 -> A, 1 -> B, ..., 25 -> Z
};


// utils.ts or inside component
const countCorrectLetters = (guessNums: number[], hiddenWord: string) => {
  const hiddenLetters = hiddenWord.split("");
  const guessLetters = guessNums.map(numberToLetter);
  return guessLetters.filter((l) => hiddenLetters.includes(l)).length;
};

// New function: get winner / tie info
// Helper: get winner based on correct letters
const getWinnerByCorrectLetters = (
  player1Guess: number[],
  player2Guess: number[],
  hiddenWord: string
) => {
  const count1 = countCorrectLetters(player1Guess, hiddenWord);
  const count2 = countCorrectLetters(player2Guess, hiddenWord);

  if (count1 === count2) return "tie";
  if (count1 > count2) return 1;
  return 2;
};



// Determine winner badge for frontend display based on guesses and hidden word
const determineWinnerBadge = (
  player1Guess: number[],
  player2Guess: number[],
  hiddenWord: string,
  playerName: string,
  userAddress: string
) => {
  const count1 = countCorrectLetters(player1Guess, hiddenWord);
  const count2 = countCorrectLetters(player2Guess, hiddenWord);

  if (count1 === count2) return "tie"; // Tie case
  if (
    (playerName === userAddress && count1 > count2) ||
    (playerName !== userAddress && count2 > count1)
  ) {
    return "win";
  }
  return "lose";
};

// HANDLE MAKE GUESS (for normal guess flow without proof)
const handleMakeGuess = async () => {
  const playerGuessLetters = isPlayer1 ? player1Guess : player2Guess;
  console.log('Player guess letters:', playerGuessLetters);

  if (playerGuessLetters.length !== 3) {
    setError('You must select exactly 3 letters');
    return;
  }

  const playerGuessNumbers = playerGuessLetters.map(letterToNumber);
  console.log('Player guess numbers:', playerGuessNumbers);

  await runAction(async () => {
    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      const signer = getContractSigner();
      await alphaDuelService.makeGuess(sessionId, userAddress, playerGuessNumbers, signer);

      setSuccess(`Guess submitted: ${playerGuessLetters.join(', ')}`);
      if (isPlayer1) setPlayer1Guess([]);
      else setPlayer2Guess([]);

      await loadGameState();
    } catch (err) {
      console.error('Make guess error:', err);
      setError(err instanceof Error ? err.message : 'Failed to make guess');
    } finally {
      setLoading(false);
    }
  });
};



const handleCommitGuess = async () => {
  const playerGuessLetters = isPlayer1 ? player1Guess : player2Guess;
  console.log('Player guess letters:', playerGuessLetters);

  if (playerGuessLetters.length !== 3) {
    setError('You must select exactly 3 letters');
    return;
  }

  const playerGuessNumbers = playerGuessLetters.map(letterToNumber);
  console.log('Player guess numbers:', playerGuessNumbers);

  await runAction(async () => {
    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      // 1. Generate salt
    const salt = crypto.randomUUID();
    

     // 2. Compute commitment
    const commitment = computeCommitment(playerGuessNumbers, salt);

     // 3. Save salt locally (needed later for proof!)
    localStorage.setItem("guessSalt", salt);
    localStorage.setItem("guessNumbers", JSON.stringify(playerGuessNumbers));

const signer = getContractSigner();
await alphaDuelService.commitGuess(sessionId, userAddress, commitment, signer);
// Then commit to backend so all tabs see it
const playerNumber = isPlayer1 ? 1 : 2;
await alphaDuelService.commitGuessToBackend(sessionId, playerNumber, playerGuessNumbers);

      setSuccess(`Guess submitted: ${playerGuessLetters.join(', ')}`);
      setStatus("Guess committed successfully!");
      if (isPlayer1) setPlayer1Guess([]);
      else setPlayer2Guess([]);

      await loadGameState();
    } catch (err) {
      console.error('Make guess error:', err);
      setError(err instanceof Error ? err.message : 'Failed to make guess');
    } finally {
      setLoading(false);
    }
  });
};

 //HANDLE GENERATE PROOF (for Reveal with Proof flow)
  const handleGenerateProof = async () => {
  try {
    setProofLoading(true);
    setError(null);
    setSuccess(null)

    const hiddenNumbers = encodeHiddenWord(getHiddenWord(gameState?.hidden_word_id || 0));

    const result = await alphaDuelService.generateProofAndValidate(
      sessionId,
      hiddenNumbers,                      // hidden word numbers
      getHiddenWord(gameState?.hidden_word_id || 0).length, // hidden_len
    );

    if (!result.isValid) {
      throw new Error("Generated proof is invalid.");
    }

    setProofHex(result.proofHex);
    setPublicInputsHex(result.publicInputs.join(", "));
    setSuccess("Proof generated and verified successfully.");

  } catch (err) {
    console.error("Proof generation failed:", err);
    setError(
      err instanceof Error
        ? err.message
        : "Failed to generate proof"
    );
  } finally {
    setProofLoading(false);
  }
};

const BASE_URL =
  window.location.hostname === "localhost"
    ? "ws://localhost:3001"
    : "wss://ws-alphaduel.vercel.app";

// useEffect(() => {
//   const ws = new WebSocket(`ws://localhost:3001?sessionId=${sessionId}`);

//  ws.onmessage = (event) => {
//   const data = JSON.parse(event.data);
//   if (data.player === 1 && data.guessNumbers) setPlayer1GuessNumbers(data.guessNumbers);
//   if (data.player === 2 && data.guessNumbers) setPlayer2GuessNumbers(data.guessNumbers);
// };


//   return () => ws.close();
// }, [sessionId]);


useEffect(() => {
  const ws = new WebSocket(`${BASE_URL}?sessionId=${sessionId}`);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.player === 1 && data.guessNumbers)
        setPlayer1GuessNumbers(data.guessNumbers);

      if (data.player === 2 && data.guessNumbers)
        setPlayer2GuessNumbers(data.guessNumbers);
    } catch (err) {
      console.error("WebSocket parse error:", err);
    }
  };

  return () => ws.close();
}, [sessionId]);


  return (
    <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-8 shadow-xl border-2 border-purple-200">
      <div className="flex items-center mb-6">
        <div>
          <h2 className="text-3xl font-black bg-gradient-to-r from-purple-600 via-pink-600 to-red-600 bg-clip-text text-transparent">
            Alpha Duel Game
          </h2>
          <p className="text-sm text-gray-700 font-semibold mt-1">
            Each player picks 3 letters. Closest guesses to the hidden word win!
          </p>
          <p className="text-lg text-gray-500 font-mono mt-1">
            Session ID: {sessionId}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-gradient-to-r from-red-50 to-pink-50 border-2 border-red-200 rounded-xl">
          <p className="text-sm font-semibold text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl">
          <p className="text-sm font-semibold text-green-700">{success}</p>
        </div>
      )}

      {/* CREATE GAME PHASE */}
      {gamePhase === 'create' && (
        <div className="space-y-6">
          {/* Mode Toggle */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 p-2 bg-gray-100 rounded-xl">
            <button
              onClick={() => {
                setCreateMode('create');
                setExportedAuthEntryXDR(null);
                setImportAuthEntryXDR('');
                setImportSessionId('');
                setImportPlayer1('');
                setImportPlayer1Points('');
                setImportPlayer2Points(DEFAULT_POINTS);
                setLoadSessionId('');
              }}
              className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all ${
                createMode === 'create'
                  ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Create & Export
            </button>
            <button
              onClick={() => {
                setCreateMode('import');
                setExportedAuthEntryXDR(null);
                setLoadSessionId('');
              }}
              className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all ${
                createMode === 'import'
                  ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Import Auth Entry
            </button>
            <button
              onClick={() => {
                setCreateMode('load');
                setExportedAuthEntryXDR(null);
                setImportAuthEntryXDR('');
                setImportSessionId('');
                setImportPlayer1('');
                setImportPlayer1Points('');
                setImportPlayer2Points(DEFAULT_POINTS);
              }}
              className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all ${
                createMode === 'load'
                  ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-lg'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Load Existing Game
            </button>
          </div>

          <div className="p-4 bg-gradient-to-r from-yellow-50 to-orange-50 border-2 border-yellow-200 rounded-xl">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-yellow-900">⚡ Quickstart (Dev)</p>
                <p className="text-xs font-semibold text-yellow-800">
                  Creates and signs for both dev wallets in one click. Works only in the Games Library.
                </p>
              </div>
              <button
                onClick={handleQuickStart}
                disabled={isBusy || !quickstartAvailable}
                className="px-4 py-3 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-md hover:shadow-lg transform hover:scale-105 disabled:transform-none"
              >
                {quickstartLoading ? 'Quickstarting...' : '⚡ Quickstart Game'}
              </button>
            </div>
          </div>

          {createMode === 'create' ? (
            <div className="space-y-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Your Address (Player 1)
              </label>
              <input
                type="text"
                value={player1Address}
                onChange={(e) => setPlayer1Address(e.target.value.trim())}
                placeholder="G..."
                className="w-full px-4 py-3 rounded-xl bg-white border-2 border-gray-200 focus:outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-100 text-sm font-medium text-gray-700"
              />
              <p className="text-xs font-semibold text-gray-600 mt-1">
                Pre-filled from your connected wallet. If you change it, you must be able to sign as that address.
              </p>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Your Points
              </label>
              <input
                type="text"
                value={player1Points}
                onChange={(e) => setPlayer1Points(e.target.value)}
                placeholder="0.1"
                className="w-full px-4 py-3 rounded-xl bg-white border-2 border-gray-200 focus:outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-100 text-sm font-medium"
              />
              <p className="text-xs font-semibold text-gray-600 mt-1">
                Available: {(Number(availablePoints) / 10000000).toFixed(2)} Points
              </p>
            </div>

            <div className="p-3 bg-blue-50 border-2 border-blue-200 rounded-xl">
              <p className="text-xs font-semibold text-blue-800">
                ℹ️ Player 2 will specify their own address and points when they import your auth entry. You only need to prepare and export your signature.
              </p>
            </div>
          </div>

          <div className="pt-4 border-t-2 border-gray-100 space-y-4">
            <p className="text-xs font-semibold text-gray-600">
              Session ID: {sessionId}
            </p>

            {!exportedAuthEntryXDR ? (
              <button
                onClick={handlePrepareTransaction}
                disabled={isBusy}
                className="w-full py-4 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg hover:shadow-xl transform hover:scale-105 disabled:transform-none"
              >
                {loading ? 'Preparing...' : 'Prepare & Export Auth Entry'}
              </button>
            ) : (
              <div className="space-y-3">
                <div className="p-4 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl">
                  <p className="text-xs font-bold uppercase tracking-wide text-green-700 mb-2">
                    Auth Entry XDR (Player 1 Signed)
                  </p>
                  <div className="bg-white p-3 rounded-lg border border-green-200 mb-3">
                    <code className="text-xs font-mono text-gray-700 break-all">
                      {exportedAuthEntryXDR}
                    </code>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      onClick={copyAuthEntryToClipboard}
                      className="py-3 rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-bold text-sm transition-all shadow-md hover:shadow-lg transform hover:scale-105"
                    >
                      {authEntryCopied ? '✓ Copied!' : '📋 Copy Auth Entry'}
                    </button>
                    <button
                      onClick={copyShareGameUrlWithAuthEntry}
                      className="py-3 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-bold text-sm transition-all shadow-md hover:shadow-lg transform hover:scale-105"
                    >
                      {shareUrlCopied ? '✓ Copied!' : '🔗 Share URL'}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-gray-600 text-center font-semibold">
                  Copy the auth entry XDR or share URL with Player 2 to complete the transaction
                </p>
              </div>
            )}
          </div>
            </div>
          ) : createMode === 'import' ? (
            /* IMPORT MODE */
            <div className="space-y-4">
              <div className="p-4 bg-gradient-to-br from-blue-50 to-cyan-50 border-2 border-blue-200 rounded-xl">
                <p className="text-sm font-semibold text-blue-800 mb-2">
                  📥 Import Auth Entry from Player 1
                </p>
                <p className="text-xs text-gray-700 mb-4">
                  Paste the auth entry XDR from Player 1. Session ID, Player 1 address, and their points will be auto-extracted. You only need to enter your points amount.
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1 flex items-center gap-2">
                      Auth Entry XDR
                      {xdrParsing && (
                        <span className="text-blue-500 text-xs animate-pulse">Parsing...</span>
                      )}
                      {xdrParseSuccess && (
                        <span className="text-green-600 text-xs">✓ Parsed successfully</span>
                      )}
                      {xdrParseError && (
                        <span className="text-red-600 text-xs">✗ Parse failed</span>
                      )}
                    </label>
                    <textarea
                      value={importAuthEntryXDR}
                      onChange={(e) => setImportAuthEntryXDR(e.target.value)}
                      placeholder="Paste Player 1's signed auth entry XDR here..."
                      rows={4}
                      className={`w-full px-4 py-3 rounded-xl bg-white border-2 focus:outline-none focus:ring-4 text-xs font-mono resize-none transition-colors ${
                        xdrParseError
                          ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
                          : xdrParseSuccess
                          ? 'border-green-300 focus:border-green-400 focus:ring-green-100'
                          : 'border-blue-200 focus:border-blue-400 focus:ring-blue-100'
                      }`}
                    />
                    {xdrParseError && (
                      <p className="text-xs text-red-600 font-semibold mt-1">
                        {xdrParseError}
                      </p>
                    )}
                  </div>
                  {/* Auto-populated fields from auth entry (read-only) */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">Session ID (auto-filled)</label>
                      <input
                        type="text"
                        value={importSessionId}
                        readOnly
                        placeholder="Auto-filled from auth entry"
                        className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-200 text-xs font-mono text-gray-600 cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">Player 1 Points (auto-filled)</label>
                      <input
                        type="text"
                        value={importPlayer1Points}
                        readOnly
                        placeholder="Auto-filled from auth entry"
                        className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-200 text-xs text-gray-600 cursor-not-allowed"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">Player 1 Address (auto-filled)</label>
                    <input
                      type="text"
                      value={importPlayer1}
                      readOnly
                      placeholder="Auto-filled from auth entry"
                      className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-200 text-xs font-mono text-gray-600 cursor-not-allowed"
                    />
                  </div>
                  {/* User inputs */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">Player 2 (You)</label>
                      <input
                        type="text"
                        value={userAddress}
                        readOnly
                        className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-200 text-xs font-mono text-gray-600 cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Your Points *</label>
                      <input
                        type="text"
                        value={importPlayer2Points}
                        onChange={(e) => setImportPlayer2Points(e.target.value)}
                        placeholder="e.g., 0.1"
                        className="w-full px-4 py-2 rounded-xl bg-white border-2 border-blue-200 focus:outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100 text-xs"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={handleImportTransaction}
                disabled={isBusy || !importAuthEntryXDR.trim() || !importPlayer2Points.trim()}
                className="w-full py-4 rounded-xl font-bold text-white text-lg bg-gradient-to-r from-blue-500 via-cyan-500 to-teal-500 hover:from-blue-600 hover:via-cyan-600 hover:to-teal-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-xl hover:shadow-2xl transform hover:scale-105 disabled:transform-none"
              >
                {loading ? 'Importing & Signing...' : 'Import & Sign Auth Entry'}
              </button>
            </div>
          ) : createMode === 'load' ? (
            /* LOAD EXISTING GAME MODE */
            <div className="space-y-4">
              <div className="p-4 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl">
                <p className="text-sm font-semibold text-green-800 mb-2">
                  🎮 Load Existing Game by Session ID
                </p>
                <p className="text-xs text-gray-700 mb-4">
                  Enter a session ID to load and continue an existing game. You must be one of the players.
                </p>
                <input
                  type="text"
                  value={loadSessionId}
                  onChange={(e) => setLoadSessionId(e.target.value)}
                  placeholder="Enter session ID (e.g., 123456789)"
                  className="w-full px-4 py-3 rounded-xl bg-white border-2 border-green-200 focus:outline-none focus:border-green-400 focus:ring-4 focus:ring-green-100 text-sm font-mono"
                />
              </div>

              <div className="p-4 bg-gradient-to-br from-yellow-50 to-amber-50 border-2 border-yellow-200 rounded-xl">
                <p className="text-xs font-bold text-yellow-800 mb-2">
                  Requirements
                </p>
                <ul className="text-xs text-gray-700 space-y-1 list-disc list-inside">
                  <li>You must be Player 1 or Player 2 in the game</li>
                  <li>Game must be active (not completed)</li>
                  <li>Valid session ID from an existing game</li>
                </ul>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={handleLoadExistingGame}
                  disabled={isBusy || !loadSessionId.trim()}
                  className="py-4 rounded-xl font-bold text-white text-lg bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500 hover:from-green-600 hover:via-emerald-600 hover:to-teal-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-xl hover:shadow-2xl transform hover:scale-105 disabled:transform-none"
                >
                  {loading ? 'Loading...' : '🎮 Load Game'}
                </button>
                <button
                  onClick={copyShareGameUrlWithSessionId}
                  disabled={!loadSessionId.trim()}
                  className="py-4 rounded-xl font-bold text-white text-lg bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-xl hover:shadow-2xl transform hover:scale-105 disabled:transform-none"
                >
                  {shareUrlCopied ? '✓ Copied!' : '🔗 Share Game'}
                </button>
              </div>
              <p className="text-xs text-gray-600 text-center font-semibold">
                Load the game to continue playing, or share the URL with another player
              </p>
            </div>
          ) : null}
        </div>
      )}

      
      {/* GUESS PHASE */}
{gamePhase === 'guess' && gameState && (
  <div className="space-y-6">

    {/* Players grid */}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {[1, 2].map((playerNum) => {
        const isCurrentPlayer = (playerNum === 1 ? isPlayer1 : isPlayer2);
        const playerName = playerNum === 1 ? gameState.player1 : gameState.player2;
        const playerPoints = playerNum === 1 ? gameState.player1_points : gameState.player2_points;
        const playerGuess = playerNum === 1 ? player1Guess : player2Guess;
        const playerHasGuessed = playerNum === 1 ? gameState.player1_guess_commitment : gameState.player2_guess_commitment;

        return (
          <div
            key={playerNum}
            className={`p-5 rounded-xl border-2 ${
              isCurrentPlayer
                ? 'border-purple-400 bg-gradient-to-br from-purple-50 to-pink-50 shadow-lg'
                : 'border-gray-200 bg-white'
            }`}
          >
            <div className="text-xs font-bold uppercase tracking-wide text-gray-600 mb-1">
              Player {playerNum}
            </div>
            <div className="font-mono text-sm font-semibold mb-2 text-gray-800">
              {playerName.slice(0, 8)}...{playerName.slice(-4)}
            </div>
            <div className="text-xs font-semibold text-gray-600">
              Points: {(Number(playerPoints) / 10000000).toFixed(2)}
            </div>

            {/* Status indicator */}
            <div className="mt-3">
              {playerHasGuessed && playerHasGuessed.length > 0 ? (
                <div className="inline-block px-3 py-1 rounded-full bg-gradient-to-r from-green-400 to-emerald-500 text-white text-xs font-bold shadow-md">
                  ✓ Guessed
                </div>
              ) : (
                <div className="inline-block px-3 py-1 rounded-full bg-gray-200 text-gray-600 text-xs font-bold">
                  Waiting...
                </div>
              )}
            </div>

            {/* Guess letters */}
            <div className="mt-3">
              <p className="font-semibold mb-2">Player {playerNum} Guess:</p>
              <div className="flex flex-wrap gap-2 mb-1">
                {ALPHABET.map((letter) => (
                  <button
                    key={`${playerNum}-${letter}`}
                    onClick={() => handleLetterClick(playerNum, letter)}
                    disabled={!isCurrentPlayer || playerGuess.includes(letter)}
                    className={`px-3 py-1 rounded font-bold text-white transition ${
                      !isCurrentPlayer
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        : playerGuess.includes(letter)
                        ? 'bg-gray-400 cursor-not-allowed'
                        : 'bg-pink-500 hover:bg-pink-600'
                    }`}
                  >
                    {letter}
                  </button>
                ))}
              </div>
              <p className="text-md">Selected: {playerGuess.join(', ')}</p>

              {!isCurrentPlayer && (
                <p className="text-xs text-red-500 mt-1">
                  Switch to Player {playerNum} wallet to make guesses.
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>

    {/* Submit Guess Button */}
    {(isPlayer1 || isPlayer2) && !hasGuessed && (
      <button
        onClick={handleCommitGuess} //handleMakeGuess or handleCommitGuess based on whether you want to implement commit-reveal
        disabled={
          (isPlayer1 && player1Guess.length !== 3) ||
          (isPlayer2 && player2Guess.length !== 3) ||
          false
        }
        className="w-full mt-4 py-4 rounded-xl font-bold text-white text-lg bg-gradient-to-r from-purple-500 via-pink-500 to-red-500 hover:from-purple-600 hover:via-pink-600 hover:to-red-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-xl hover:shadow-2xl transform hover:scale-105 disabled:transform-none"
      >
        {loading ? 'Submitting...' : 'Submit Guess'}
      </button>
    )}

    {/* Waiting for other player */}
    {hasGuessed && (
      <div className="p-4 bg-blue-50 border-2 border-blue-200 rounded-xl text-center">
        <p className="text-sm font-semibold text-blue-700">
          ✓ You've made your guess. Waiting for the other player...
        </p>
      </div>
    )}
  </div>
)}

{/* REVEAL PHASE */}
{gamePhase === 'reveal' && (
  <div className="space-y-6">
    <div className="p-8 bg-yellow-50 border-2 border-yellow-300 rounded-2xl text-center shadow-xl">
      <div className="text-6xl mb-4">🎊</div>
      <h3 className="text-2xl font-black text-gray-900 mb-3">
        Both Players Have Guessed!
      </h3>
      <p className="text-sm font-semibold text-gray-700 mb-6">
        Click below to reveal the winner
      </p>
      <button
        onClick={handleRevealWinnerWithProof}
        disabled={isBusy}
        className="px-10 py-4 rounded-xl font-bold text-white text-lg bg-gradient-to-r from-yellow-500 via-orange-500 to-amber-500 hover:from-yellow-600 hover:via-orange-600 hover:to-amber-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-xl hover:shadow-2xl transform hover:scale-105 disabled:transform-none"
      >
        {loading ? 'Revealing...' : 'Reveal Winner'}
      </button>
      <button
  onClick={async () => {
  if (!showHexOutput) {
    await handleGenerateProof(); // your proof generation function
  }
  setShowHexOutput(prev => !prev);
}}
  className="
   ml-4 px-10 py-4 rounded-xl font-bold text-white text-lg bg-gradient-to-r from-yellow-500 via-orange-500 to-amber-500 hover:from-yellow-600 hover:via-orange-600 hover:to-amber-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-xl hover:shadow-2xl transform hover:scale-105 disabled:transform-none
  "
>
  {showHexOutput ? "Hide Winner Proof" : "Generate Winner Proof"}
</button>

  {/* ---------------------- */}
 {/* 🧾 Hex Output Section */}
 {/* ---------------------- */}
{showHexOutput && (
 <div className="mt-16 p-4 bg-white/70 border border-green-200 rounded-xl shadow-inner hover:shadow-lg transition-shadow">
      <h3 className="text-lg font-bold text-gray-800 mb-3">Hex Output</h3>

      {/* Proof */}
      <div className="relative">
        <label className="block text-sm font-semibold text-black mb-1">
          Proof (hex)
        </label>
        <textarea
          value={proofHex}
          readOnly
          className="
            w-full
            h-26
            px-2
            text-black
            text-xs
            bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50
            border
            border-green-200
            rounded-md
            selection:bg-yellow-200
            selection:text-black
          "
        />
        <button
          onClick={() => handleCopy(proofHex, "proof")}
          className="absolute -top-2 right-2 p-1 rounded-md bg-green-200 text-black hover:bg-green-300"
        >
          <Clipboard className="w-4 h-4" />
        </button>
        {copied === "proof" && (
          <span className="absolute -top-2 right-10 text-sm text-green-700 font-semibold">
            Copied!
          </span>
        )}
      </div>

      {/* Public Inputs */}
      <div className="relative mt-4">
        <label className="block text-sm font-semibold text-black mb-1">
          Public_Inputs (hex)
        </label>
        <textarea
          value={publicInputsHex}
          readOnly
          className="
            w-full
            h-10
            p-2
            font-bold
            text-black
            text-lg
            bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50
            border
            border-green-200
            rounded-md
            selection:bg-yellow-200
            selection:text-black
          "
        />
        <button
          onClick={() => handleCopy(publicInputsHex, "public")}
          className="absolute -top-2 right-2 p-1 rounded-md bg-green-200 text-black hover:bg-green-300"
        >
          <Clipboard className="w-4 h-4" />
        </button>
        {copied === "public" && (
          <span className="absolute -top-2 right-10 text-sm text-green-700 font-semibold">
            Copied!
          </span>
        )}
        
      </div>

      <div className="relative mt-4">
        <label className="block text-sm font-semibold text-gray-700 mb-1">
          Deployed Game Contract
        </label>
        <textarea
          value="CAQZEXWXTC2KSIMOVZUTMSL5O3ULKDSLLF2LRWIB7GYHJWVZINVGSAC3"
          readOnly
          className="
            w-full
            h-10
            p-2
            font-bold
            text-black
            text-lg
            bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50
            border
            border-green-200
            rounded-md
            selection:bg-yellow-200
            selection:text-black
          "
        />
        <button
          onClick={() => handleCopy("CAPFXZGLINDRLETIES2G7STFJJ4OJYHX66ES4FHUQFVCTRTJNZVKIZWY", "gameContract")}
          className="absolute -top-2 right-2 p-1 rounded-md bg-green-200 text-black hover:bg-green-300"
        >
          <Clipboard className="w-4 h-4" />
        </button>
        {copied === "gameContract" && (
          <span className="absolute -top-2 right-10 text-sm text-green-700 font-semibold">
            Copied!
          </span>
        )}
        <a href="https://stellar.expert/explorer/testnet/contract/CAPFXZGLINDRLETIES2G7STFJJ4OJYHX66ES4FHUQFVCTRTJNZVKIZWY?filter=history" target="_blank" rel="noopener noreferrer" className="absolute -top-2 right-16 text-sm text-blue-600 hover:text-blue-800">
          View on Explorer
        </a>
      </div>
    </div>
 )}
    </div>
  </div>
)}

      {/* COMPLETE PHASE */}
{gamePhase === 'complete' && gameState && (
  <div className="space-y-6">

    {/* Game Complete Card */}
    <div className="p-8 bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 border-2 border-green-300 rounded-2xl text-center shadow-xl">
      <div className="text-6xl mb-4 animate-bounce">🏆</div>
      <h3 className="text-2xl font-black text-gray-900 mb-3">Game Complete!</h3>

      {/* Show Hidden Word */}
      <div className="mb-6">
        <p className="text-sm font-semibold text-gray-700 mb-1">Hidden Word:</p>
        <div className="inline-flex flex-wrap gap-1 justify-center">
          {getHiddenWord(gameState.hidden_word_id).split('').map((letter, idx) => (
            <span
              key={idx}
              className="px-2 py-1 bg-yellow-100 border border-yellow-300 rounded shadow-sm font-bold text-gray-800"
            >
              {letter.toUpperCase()}
            </span>
          ))}
        </div>
      </div>
      
      {/* Result Summary */}
      {result && (
        <div className="text-lg font-semibold text-green-700 mb-6">
          <pre className="whitespace-pre-wrap">{result}</pre>
        </div>
      )}

      {/* Players Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {[1, 2].map((playerNum) => {
          const playerName = playerNum === 1 ? gameState.player1 : gameState.player2;
          const playerGuess = playerNum === 1 ? player1Guess : player2Guess;
          const playerPoints = playerNum === 1 ? gameState.player1_points : gameState.player2_points;
          
          return (
            <div
              key={playerNum}
              className="p-4 bg-white/70 border border-green-200 rounded-xl shadow-inner hover:shadow-lg transition-shadow"
            >
              <p className="text-xs font-bold uppercase tracking-wide text-gray-600 mb-1">
                Player {playerNum}
              </p>
              <p className="font-mono text-xs text-gray-700 mb-2">
                {playerName.slice(0, 8)}...{playerName.slice(-4)}
              </p>
              <p className="text-xs font-semibold text-gray-600">
                Points: {(Number(playerPoints) / 10000000).toFixed(2)}
              </p>
              <p className="text-sm font-semibold text-gray-800 mt-2">
              {playerNum === 1 && "Player1 Guess: " + player1GuessNumbers.map(n => numberToLetter(n)).join('')}
              {playerNum === 2 && " Player2 Guess: " + player2GuessNumbers.map(n => numberToLetter(n)).join('')}
 </p>

   {/* Correct Count */}
       <p className="mt-3 text-sm font-semibold text-gray-700">
  Correct Letters:{" "}
  <span className="font-black text-green-700">
    {playerNum === 1 &&
      countCorrectLetters(
        player1GuessNumbers,
        getHiddenWord(gameState.hidden_word_id)
      )}

    {playerNum === 2 &&
      countCorrectLetters(
        player2GuessNumbers,
        getHiddenWord(gameState.hidden_word_id)
      )}
  </span>
 </p>

 
{/* Winner Badge */}
{(() => {
  const hidden = getHiddenWord(gameState.hidden_word_id);
  const winnerL = getWinnerByCorrectLetters(
    player1GuessNumbers,
    player2GuessNumbers,
    hidden
  );

  if (winnerL === "tie") {
    return (
      <div className="mt-4 inline-block px-4 py-2 rounded-full bg-yellow-500 text-white font-bold text-xs shadow-md">
        🤝 It's a tie!
      </div>
    );
  }

  if (
    (winnerL === 1 && playerNum === 1) ||
    (winnerL === 2 && playerNum === 2)
  ) {
    return (
      <div className="mt-4 inline-block px-4 py-2 rounded-full bg-green-600 text-white font-bold text-xs shadow-md">
        {winnerAddr === playerName && userAddress ? "🎉 You Won!" : "🏆 Winner"}
      </div>
    );
  }

  return null; // losing player
})()}


            </div>
          );
        })}
      </div>
 
    </div>

    {/* Start New Game Button */}
    <button
      onClick={handleEndGame}
      className="mt-2 w-full py-4 rounded-xl bg-red-600 text-white font-bold text-gray-700 hover:from-green-500 hover:to-green-700 transition-all shadow-lg hover:shadow-xl transform hover:scale-105"
    >
      End Game & Start New Game
    </button>
  </div>
 )}
    </div>
  );
}