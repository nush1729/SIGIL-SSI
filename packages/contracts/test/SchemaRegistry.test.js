const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SchemaRegistry", function () {
  let registry, owner, other;

  beforeEach(async function () {
    [owner, other] = await ethers.getSigners();
    const SchemaRegistry = await ethers.getContractFactory("SchemaRegistry");
    registry = await SchemaRegistry.deploy();
    await registry.waitForDeployment();
  });

  it("sets deployer as owner", async function () {
    expect(await registry.owner()).to.equal(owner.address);
  });

  it("registers a new schema at version 1 and emits SchemaRegistered", async function () {
    const key = await registry.schemaKey("10th Marksheet");

    await expect(
      registry.registerSchema("10th Marksheet", ["student_name", "board_name", "roll_number"])
    )
      .to.emit(registry, "SchemaRegistered")
      .withArgs(key, "10th Marksheet", ["student_name", "board_name", "roll_number"], 1);

    const schema = await registry.getSchema("10th Marksheet");
    expect(schema.fields).to.deep.equal(["student_name", "board_name", "roll_number"]);
    expect(schema.version).to.equal(1);
    expect(schema.active).to.equal(true);
  });

  it("re-registering an existing schema bumps its version", async function () {
    await registry.registerSchema("Passport", ["full_name", "passport_number"]);
    await registry.registerSchema("Passport", ["full_name", "passport_number", "nationality"]);

    const schema = await registry.getSchema("Passport");
    expect(schema.version).to.equal(2);
    expect(schema.fields).to.deep.equal(["full_name", "passport_number", "nationality"]);
  });

  it("deprecates a schema without deleting its history", async function () {
    await registry.registerSchema("PAN", ["full_name", "pan_number"]);
    await expect(registry.deprecateSchema("PAN"))
      .to.emit(registry, "SchemaDeprecated");

    const schema = await registry.getSchema("PAN");
    expect(schema.active).to.equal(false);
    expect(schema.fields).to.deep.equal(["full_name", "pan_number"]); // history preserved
  });

  it("reverts deprecating an unknown schema", async function () {
    await expect(registry.deprecateSchema("Nonexistent")).to.be.revertedWith(
      "Unknown schema"
    );
  });

  it("lists all registered schema names, including deprecated ones", async function () {
    await registry.registerSchema("Aadhaar", ["full_name", "aadhaar_number"]);
    await registry.registerSchema("Voter ID", ["full_name", "voter_id_number"]);
    await registry.deprecateSchema("Voter ID");

    const names = await registry.getAllSchemaNames();
    expect(names).to.deep.equal(["Aadhaar", "Voter ID"]);
  });

  it("only owner can register or deprecate schemas", async function () {
    await expect(
      registry.connect(other).registerSchema("Fake", ["x"])
    ).to.be.revertedWith("Not owner");

    await registry.registerSchema("Real", ["x"]);
    await expect(
      registry.connect(other).deprecateSchema("Real")
    ).to.be.revertedWith("Not owner");
  });

  it("reverts registering with an empty name or empty fields", async function () {
    await expect(registry.registerSchema("", ["x"])).to.be.revertedWith("Empty name");
    await expect(registry.registerSchema("Something", [])).to.be.revertedWith(
      "Empty fields"
    );
  });
});
