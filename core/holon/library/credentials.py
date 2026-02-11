import json
import sqlite3
import sys
from pathlib import Path
from typing import Dict, Optional, ClassVar

class CredentialsManager:
    """Manages provider credentials with SQLite persistence.
    
    Stores credentials in a local 'vault.db' file.
    """
    _instance: ClassVar[Optional["CredentialsManager"]] = None
    _db_path: Path

    def __new__(cls) -> "CredentialsManager":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            # Find project root or use current dir
            # In dev, we typically run from the root
            holon_dir = Path(".holon")
            try:
                holon_dir.mkdir(exist_ok=True)
            except OSError:
                # Fallback to current directory if .holon cannot be created
                holon_dir = Path(".")
            
            cls._instance._db_path = holon_dir / "vault.db"
            cls._instance._init_db()
        return cls._instance

    def _init_db(self) -> None:
        """Initialize the database and create tables if they don't exist."""
        try:
            with sqlite3.connect(self._db_path) as conn:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS credentials (
                        provider TEXT PRIMARY KEY,
                        data TEXT NOT NULL
                    )
                """)
        except sqlite3.Error as e:
            print(f"[CREDENTIALS] Error initializing database: {e}", file=sys.stderr)

    def set_credentials(self, provider: str, data: Dict[str, str]) -> None:
        """Store credentials for a provider in the vault."""
        try:
            with sqlite3.connect(self._db_path) as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO credentials (provider, data) VALUES (?, ?)",
                    (provider, json.dumps(data))
                )
        except sqlite3.Error as e:
            print(f"[CREDENTIALS] Error saving credentials for {provider}: {e}", file=sys.stderr)

    def get_credentials(self, provider: str) -> Dict[str, str]:
        """Retrieve credentials for a provider from the vault."""
        try:
            with sqlite3.connect(self._db_path) as conn:
                cursor = conn.execute("SELECT data FROM credentials WHERE provider = ?", (provider,))
                row = cursor.fetchone()
                if row:
                    return json.loads(row[0])
        except (sqlite3.Error, json.JSONDecodeError) as e:
            print(f"[CREDENTIALS] Error retrieving credentials for {provider}: {e}", file=sys.stderr)
        return {}

    def get_api_key(self, provider: str) -> Optional[str]:
        """Convenience method for API key."""
        creds = self.get_credentials(provider)
        return creds.get("api_key")

credentials_manager = CredentialsManager()
