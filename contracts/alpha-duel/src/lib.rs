#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, Env, Vec,Bytes, BytesN, IntoVal, contractclient, vec
};
use soroban_sdk::panic_with_error;


use core::option::Option;

/* ------------------------------------------------ */
/*                     GAME HUB CLIENT              */
/* ------------------------------------------------ */

#[contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );

    fn end_game(
        env: Env,
        session_id: u32,
        player1_won: bool
    );
}

/* ------------------------------------------------ */
/*                      ERRORS                      */
/* ------------------------------------------------ */

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    GameNotFound = 1,
    NotPlayer = 2,
    AlreadyGuessed = 3,
    BothPlayersNotGuessed = 4,
    GameAlreadyEnded = 5,
    InvalidGuessLength = 6,
    AlreadyCommitted = 7,
}

/* ------------------------------------------------ */
/*                  STORAGE KEYS                    */
/* ------------------------------------------------ */

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Game(u32),
    GameHubAddress,
    Admin,
}

/* ------------------------------------------------ */
/*                      GAME STATE                  */
/* ------------------------------------------------ */

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
    pub player1: Address,
    pub player1_guess: Option<Vec<u32>>,
    pub player1_points: i128,

    pub player2: Address,
    pub player2_guess: Option<Vec<u32>>,
    pub player2_points: i128,

    pub winner: Option<Address>,

    pub hidden_word_id: u32,

    pub player1_guess_commitment: Option<BytesN<32>>,
    pub player2_guess_commitment: Option<BytesN<32>>
}

// ============================================================================
// Storage TTL Management
// ============================================================================
// TTL (Time To Live) ensures game data doesn't expire unexpectedly
// Games are stored in temporary storage with a minimum 30-day retention

/// TTL for game storage (30 days in ledgers, ~5 seconds per ledger)
/// 30 days = 30 * 24 * 60 * 60 / 5 = 518,400 ledgers
const GAME_TTL_LEDGERS: u32 = 518_400;

/* ------------------------------------------------ */
/*                    CONTRACT                      */
/* ------------------------------------------------ */

#[contract]
pub struct AlphaDuelContract;

#[contractimpl]
impl AlphaDuelContract {
    /* -------------------------------------------- */
    /* INIT                                         */
    /* -------------------------------------------- */
    pub fn __constructor(env: Env, admin: Address, game_hub: Address) {
        // Store admin and GameHub address
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &game_hub);
    }

    /* -------------------------------------------- */
    /* START GAME (MUST MATCH GAMEHUB)              */
    /* -------------------------------------------- */
    pub fn start_game(
        env: Env,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    ) -> Result<(), Error> {
        // Prevent self-play: Player 1 and Player 2 must be different
        if player1 == player2 {
            panic!("Cannot play against yourself: Player 1 and Player 2 must be different addresses");
        }
         // Require authentication from both players (they consent to committing points)
        player1.require_auth_for_args(vec![&env, session_id.into_val(&env), player1_points.into_val(&env)]);
        player2.require_auth_for_args(vec![&env, session_id.into_val(&env), player2_points.into_val(&env)]);
        
         // Get GameHub address
        let game_hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set");

        // Create GameHub client
        let game_hub = GameHubClient::new(&env, &game_hub_addr);

        // Call the Game Hub to start the session and lock points
        // This requires THIS contract's authorization (env.current_contract_address())
        game_hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &player1,
            &player2,
            &player1_points,
            &player2_points,
        );

        // Random hidden word based on session_id
        let hidden_word_id = session_id % 50;

        let game = Game {
            player1,
            player1_guess: None,
            player1_points,

            player2,
            player2_guess: None,
            player2_points,

            winner: None,
            hidden_word_id,
            player1_guess_commitment: None, 
            player2_guess_commitment: None,
        };

        // Store game in temporary storage with 30-day TTL
        let game_key = DataKey::Game(session_id);
        env.storage().temporary().set(&game_key, &game);

        // Set TTL to ensure game is retained for at least 30 days
        env.storage()
            .temporary()
            .extend_ttl(&game_key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        // Event emitted by GameHub contract (GameStarted)

        Ok(())
    }

    /* -------------------------------------------- */
    /* GET GAME                                     */
    /* -------------------------------------------- */
    pub fn get_game(env: Env, session_id: u32) -> Result<Game, Error> {
        let key = DataKey::Game(session_id);
        env.storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)
    }
    /* -------------------------------------------- */
    /* MAKE GUESS (3 LETTERS)                       */
    /* -------------------------------------------- */
    pub fn make_guess(env: Env, session_id: u32, player: Address, guess: Vec<u32>) -> Result<(), Error> {
    player.require_auth();

    let key = DataKey::Game(session_id);
    let mut game: Game = env
        .storage()
        .temporary()
        .get(&key)
        .ok_or(Error::GameNotFound)?; // ✅ Correct

    if game.winner.is_some() {
        panic_with_error!(env, Error::GameAlreadyEnded);
    }

    if player == game.player1 {
        if game.player1_guess.is_some() {
            panic_with_error!(env, Error::AlreadyGuessed);
        }
        game.player1_guess = Some(guess);
    } else if player == game.player2 {
        if game.player2_guess.is_some() {
            panic_with_error!(env, Error::AlreadyGuessed);
        }
        game.player2_guess = Some(guess);
    } else {
        panic_with_error!(env, Error::NotPlayer);
    }

    env.storage()
        .temporary()
        .set(&key, &game);

    Ok(())
}

/* -------------------------------------------- */
    /* COMMIT GUESS TO CONTRACT                */
    /* -------------------------------------------- */
pub fn commit_guess(
    env: Env,
    session_id: u32,
    player: Address,
    guess_commitment: BytesN<32>,
) -> Result<(), Error> {
    player.require_auth();

    let key = DataKey::Game(session_id);
    let mut game: Game = env.storage().temporary()
        .get(&key)
        .ok_or(Error::GameNotFound)?;

         // Ensure game is active
    if game.winner.is_some() {
        return Err(Error::GameAlreadyEnded);
    }

    // Player1 commits
    if player == game.player1 {
        if game.player1_guess_commitment.is_some() {
            return Err(Error::AlreadyCommitted);
        }
        game.player1_guess_commitment = Some(guess_commitment); 
    } 
    // Player2 commits
    else if player == game.player2 {
        if game.player2_guess_commitment.is_some() {
            return Err(Error::AlreadyCommitted);
        }
        game.player2_guess_commitment = Some(guess_commitment);
    } else {
        return Err(Error::NotPlayer);
    }

    env.storage().temporary().set(&key, &game);
    Ok(())
}

    /* -------------------------------------------- */
    /* REVEAL WINNER + REPORT TO HUB                */
    /* -------------------------------------------- */
    pub fn reveal_winner(env: Env, session_id: u32) -> Result<Address, Error> {
    let key = DataKey::Game(session_id);
    let mut game: Game = env
        .storage()
        .temporary()
        .get(&key)
        .ok_or(Error::GameNotFound)?;

    if game.player1_guess.is_none() || game.player2_guess.is_none() {
        panic_with_error!(env, Error::BothPlayersNotGuessed);
    }

    // 1️⃣ Get hidden word letters (0..25)
    let hidden = Self::get_hidden_letters(env.clone(), game.hidden_word_id);

    // 2️⃣ Unwrap guesses
    let p1_guess = game.player1_guess.clone().unwrap();
    let p2_guess = game.player2_guess.clone().unwrap();

    // 3️⃣ Count correct letters using "loose match" logic
    fn count_matches(hidden: &Vec<u32>, guess: &Vec<u32>) -> u32 {
        let mut count = 0;
        for g in guess.iter() {
            if hidden.contains(g) {
                count += 1;
            }
        }
        count
    }

    let p1_correct = count_matches(&hidden, &p1_guess);
    let p2_correct = count_matches(&hidden, &p2_guess);

    let winner = if p1_correct >= p2_correct {
            game.player1.clone()
        } else {
            game.player2.clone()
        };


    // 5️⃣ Save winner to game
    game.winner = Some(winner.clone());
    env.storage().temporary().set(&key, &game);

    Ok(winner)
}

  /* -------------------------------------------- */
    /* REVEAL WINNER WITH PROOF                     */
    /* -------------------------------------------- */
    pub fn reveal_winner_with_proof(
    env: Env,
    session_id: u32,
    proof: Bytes,
    public_inputs: Vec<u32>, // winner flag output from Noir
) -> Result<Address, Error> {

    // Load game
    let key = DataKey::Game(session_id);
    let mut game: Game = env
        .storage()
        .temporary()
        .get(&key)
        .ok_or(Error::GameNotFound)?;

    // Both players must have committed
    if game.player1_guess_commitment.is_none() || game.player2_guess_commitment.is_none() {
        panic_with_error!(env, Error::BothPlayersNotGuessed);
    }

    // ✅ Prevent double settlement
    if game.winner.is_some() {
        panic!("Game already settled");
    }

    // ---------------------------------------------------
    // ✅ Step 1: Verify proof (OFF-CHAIN for now)
    // ---------------------------------------------------
    if proof.len() == 0 {
        panic!("Proof missing");
    }

    // ---------------------------------------------------
    // ✅ Step 2: Extract winner from Noir public output
    // ---------------------------------------------------
    //
    // Noir circuit outputs:
    // winner_flag = 1 → player1 wins
    // winner_flag = 2 → player2 wins
    //
    if public_inputs.len() < 1 {
        panic!("Missing public winner output");
    }

    let winner_flag = public_inputs.get(0).unwrap();

    let winner: Address = if winner_flag == 1 {
        game.player1.clone()
    } else if winner_flag == 2 {
        game.player2.clone()
    } else {
        panic!("Invalid winner flag");
    };

    // ---------------------------------------------------
    // ✅ Step 3: Save winner on-chain
    // ---------------------------------------------------

    if winner == game.player1 {

    // Player1 wins → take player2 points
    game.player1_points += game.player2_points;
    game.player2_points = 0;

} else if winner == game.player2 {

    // Player2 wins → take player1 points
    game.player2_points += game.player1_points;
    game.player1_points = 0;

} else {
    panic!("Winner address does not match players");
}

    game.winner = Some(winner.clone());
    env.storage().temporary().set(&key, &game);

    Ok(winner)
}


 //  /* -------------------------------------------- */
    /* END GAME AND REPORT TO HUB                   */
    /* -------------------------------------------- */
pub fn end_game(env: Env, session_id: u32, caller: Address) -> Result<(), Error> {

    // Caller must sign
    caller.require_auth();

    let key = DataKey::Game(session_id);

    let game: Game = env
        .storage()
        .temporary()
        .get(&key)
        .ok_or(Error::GameNotFound)?;

           // Both players must have committed
    if game.player1_guess_commitment.is_none() || game.player2_guess_commitment.is_none() {
        panic_with_error!(env, Error::BothPlayersNotGuessed);
    }


    // Ensure winner exists
    let winner = game.winner.clone().ok_or(Error::BothPlayersNotGuessed)?;

    let game_hub_addr: Address = env
        .storage()
        .instance()
        .get(&DataKey::GameHubAddress)
        .expect("GameHub address not set");

    let game_hub = GameHubClient::new(&env, &game_hub_addr);

    let player1_won = winner == game.player1;

    game_hub.end_game(&session_id, &player1_won);

    Ok(())
}


    /* -------------------------------------------- */
    /* FULL 50 WORD POOL (Frontend Exact Match)     */
    /* -------------------------------------------- */
    fn get_hidden_letters(env: Env, id: u32) -> Vec<u32> {
        let word = match id {
            0 => "APPLE",
            1 => "BANANA",
            2 => "ORANGE",
            3 => "GRAPE",
            4 => "MANGO",
            5 => "PEACH",
            6 => "LEMON",
            7 => "CHERRY",
            8 => "PEAR",
            9 => "PLUM",
            10 => "KIWI",
            11 => "FIG",
            12 => "DATE",
            13 => "LIME",
            14 => "APRICOT",
            15 => "PAPAYA",
            16 => "GUAVA",
            17 => "PINEAPPLE",
            18 => "COCONUT",
            19 => "BLUEBERRY",
            20 => "STRAWBERRY",
            21 => "RASPBERRY",
            22 => "BLACKBERRY",
            23 => "WATERMELON",
            24 => "CANTALOUPE",
            25 => "HONEYDEW",
            26 => "NECTARINE",
            27 => "TANGERINE",
            28 => "POMEGRANATE",
            29 => "PASSIONFRUIT",
            30 => "DRAGONFRUIT",
            31 => "LYCHEE",
            32 => "JACKFRUIT",
            33 => "CRANBERRY",
            34 => "MULBERRY",
            35 => "FIGS",
            36 => "DATEFRUIT",
            37 => "OLIVE",
            38 => "QUINCE",
            39 => "KUMQUAT",
            40 => "AVOCADO",
            41 => "MANDARIN",
            42 => "PEPPERMINT",
            43 => "CLEMENTINE",
            44 => "GRAPEFRUIT",
            45 => "STARFRUIT",
            46 => "BILBERRY",
            47 => "GOOSEBERRY",
            48 => "ELDERBERRY",
            _ => "SATSUMA",
        };

        Self::encode_word(env, word)
    }

    /* -------------------------------------------- */
    /* ENCODE WORD → Vec<u32> (A=0..Z=25)           */
    /* -------------------------------------------- */
    fn encode_word(env: Env, word: &str) -> Vec<u32> {
        let mut out = Vec::new(&env);

        for b in word.as_bytes() {
            let letter = (*b - b'A') as u32;
            out.push_back(letter);
        }

        out
    }

    // ========================================================================
    // Admin Functions
    // ========================================================================

    /// Get the current admin address
    ///
    /// # Returns
    /// * `Address` - The admin address
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    /// Set a new admin address
    ///
    /// # Arguments
    /// * `new_admin` - The new admin address
    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    /// Get the current GameHub contract address
    ///
    /// # Returns
    /// * `Address` - The GameHub contract address
    pub fn get_hub(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set")
    }

    /// Set a new GameHub contract address
    ///
    /// # Arguments
    /// * `new_hub` - The new GameHub contract address
    pub fn set_hub(env: Env, new_hub: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &new_hub);
    }

    /// Update the contract WASM hash (upgrade contract)
    ///
    /// # Arguments
    /// * `new_wasm_hash` - The hash of the new WASM binary
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();

        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod test;
