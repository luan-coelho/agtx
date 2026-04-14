use std::sync::{Arc, Mutex};

use rusqlite::Connection;

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub http_port: u16,
    pub http_secret: String,
}

impl AppState {
    pub fn new(conn: Connection, http_port: u16, http_secret: String) -> Self {
        Self {
            db: Arc::new(Mutex::new(conn)),
            http_port,
            http_secret,
        }
    }
}
