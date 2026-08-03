pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

// Proves that a holder's birth year, committed to privately as
// Poseidon(birthYear, salt), is at least 18 years before `currentYear` —
// without ever revealing birthYear or salt to the verifier.
//
// Public inputs:  commitment, currentYear
// Private inputs: birthYear, salt
//
// A verifier who only sees (commitment, currentYear) and a valid proof
// learns exactly one bit: "the person behind this commitment is >= 18",
// nothing else about their actual birth year.
template AgeOver18() {
    signal input birthYear;
    signal input salt;
    signal input commitment;
    signal input currentYear;

    // 1. Prove knowledge of the preimage of the public commitment.
    component hasher = Poseidon(2);
    hasher.inputs[0] <== birthYear;
    hasher.inputs[1] <== salt;
    hasher.out === commitment;

    // 2. Prove currentYear - birthYear >= 18, using a 32-bit-safe comparator
    // (years fit comfortably within 32 bits; GreaterEqThan needs a bit width
    // covering the values compared).
    component gte = GreaterEqThan(32);
    gte.in[0] <== currentYear - birthYear;
    gte.in[1] <== 18;
    gte.out === 1;
}

component main {public [commitment, currentYear]} = AgeOver18();
