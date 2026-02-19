// alphaduel_winner.nr

// Count matches between hidden word and guess
fn count_matches(hidden: [u8; 12], hidden_len: u8, guess: [u8; 3]) -> u8 {
    // Ensure guesses are unique
    assert(guess[0] != guess[1]);
    assert(guess[0] != guess[2]);
    assert(guess[1] != guess[2]);

    let mut count: u8 = 0;

    // Loop over each guess element
    for i in 0..3 {
        let g = guess[i];

     
        assert(g < 26);

        // Compare against hidden letters
        for j in 0..12 {
            if (j as u8) < hidden_len {
                let h = hidden[j];

                // Hidden must also be valid letter
                assert(h < 26);

                if h == g {
                    count += 1;
                }
            }
        }
    }

    count
}

// Main circuit
pub fn main(
    hidden: [u8; 12],         
    hidden_len: u8,          

    p1_guess: [u8; 3],
    p2_guess: [u8; 3],

    claimed_winner: pub u8
) {
    // Length must be valid
    assert(hidden_len > 0);
    assert(hidden_len <= 12);

    let p1_score = count_matches(hidden, hidden_len, p1_guess);
    let p2_score = count_matches(hidden, hidden_len, p2_guess);

    let winner = if p1_score >= p2_score { 1u8 } else { 2u8 };

    assert(winner == claimed_winner);
}
