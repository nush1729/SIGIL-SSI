// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Replaces the frontend's hardcoded DOCUMENT_SCHEMAS constant as the source
// of truth for which document types + fields issuers can use. Versioned so
// a schema can evolve without silently breaking credentials issued against
// an older version.
contract SchemaRegistry {

    address public owner;

    struct Schema {
        string name;
        string[] fields;
        uint256 version;
        bool active;
    }

    mapping(bytes32 => Schema) private schemas;
    bytes32[] private schemaKeys;
    mapping(bytes32 => bool) private schemaKeyExists;

    event SchemaRegistered(bytes32 indexed key, string name, string[] fields, uint256 version);
    event SchemaDeprecated(bytes32 indexed key, string name);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function schemaKey(string calldata name) public pure returns (bytes32) {
        return keccak256(bytes(name));
    }

    // Registering an existing (active or deprecated) name bumps its version
    // and reactivates it with the new field list.
    function registerSchema(string calldata name, string[] calldata fields) external onlyOwner {
        require(bytes(name).length > 0, "Empty name");
        require(fields.length > 0, "Empty fields");

        bytes32 key = schemaKey(name);
        uint256 nextVersion = schemaKeyExists[key] ? schemas[key].version + 1 : 1;

        if (!schemaKeyExists[key]) {
            schemaKeyExists[key] = true;
            schemaKeys.push(key);
        }

        schemas[key] = Schema({
            name: name,
            fields: fields,
            version: nextVersion,
            active: true
        });

        emit SchemaRegistered(key, name, fields, nextVersion);
    }

    function deprecateSchema(string calldata name) external onlyOwner {
        bytes32 key = schemaKey(name);
        require(schemaKeyExists[key], "Unknown schema");
        schemas[key].active = false;

        emit SchemaDeprecated(key, name);
    }

    function getSchema(string calldata name)
        external
        view
        returns (string[] memory fields, uint256 version, bool active)
    {
        Schema memory s = schemas[schemaKey(name)];
        return (s.fields, s.version, s.active);
    }

    function getAllSchemaNames() external view returns (string[] memory) {
        string[] memory names = new string[](schemaKeys.length);
        for (uint i = 0; i < schemaKeys.length; i++) {
            names[i] = schemas[schemaKeys[i]].name;
        }
        return names;
    }
}
