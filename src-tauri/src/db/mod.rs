//! SQLite storage. Two-pool model: read pool (size 8) and write pool (size 1)
//! over the same DB file. PRAGMAs installed per connection. Schema bootstrap
//! via a single collapsed migration (`migrations` module).

pub mod migrations;
