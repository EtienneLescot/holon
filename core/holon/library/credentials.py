from typing import Dict, Optional, ClassVar

class CredentialsManager:
    """Manages provider credentials.
    
    Phase 1: In-memory store.
    """
    _instance: ClassVar[Optional["CredentialsManager"]] = None
    _store: Dict[str, Dict[str, str]] = {}

    def __new__(cls) -> "CredentialsManager":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def set_credentials(self, provider: str, data: Dict[str, str]) -> None:
        """Store credentials for a provider."""
        self._store[provider] = data

    def get_credentials(self, provider: str) -> Dict[str, str]:
        """Retrieve credentials for a provider."""
        return self._store.get(provider, {})

    def get_api_key(self, provider: str) -> Optional[str]:
        """Convenience method for API key."""
        creds = self.get_credentials(provider)
        return creds.get("api_key")

credentials_manager = CredentialsManager()
