//! Text management without UI, storage, clipboard, clock, or platform dependencies.

use serde::{Deserialize, Serialize};
use std::{collections::HashSet, error::Error, fmt};

pub const SCHEMA_VERSION: u32 = 2;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Document {
    pub id: String,
    pub title: String,
    pub body: String,
    /// Unix milliseconds supplied by the host, rather than a platform clock.
    pub updated_at: u64,
    #[serde(default)]
    pub archived: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub schema_version: u32,
    pub documents: Vec<Document>,
}

impl Default for Snapshot {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            documents: Vec::new(),
        }
    }
}

#[derive(Debug)]
pub enum WorkspaceError {
    InvalidSnapshot(serde_json::Error),
    UnsupportedVersion(u32),
    InvalidId,
    DuplicateId(String),
    NotFound(String),
}

impl fmt::Display for WorkspaceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidSnapshot(error) => write!(f, "Invalid workspace snapshot: {error}"),
            Self::UnsupportedVersion(version) => {
                write!(f, "Unsupported snapshot version: {version}")
            }
            Self::InvalidId => write!(f, "A document ID must not be empty or contain whitespace"),
            Self::DuplicateId(id) => write!(f, "Duplicate document ID: {id}"),
            Self::NotFound(id) => write!(f, "Document not found: {id}"),
        }
    }
}

impl Error for WorkspaceError {}

#[derive(Clone, Debug, Default)]
pub struct Workspace {
    snapshot: Snapshot,
}

impl Workspace {
    pub fn from_json(json: &str) -> Result<Self, WorkspaceError> {
        let mut snapshot: Snapshot =
            serde_json::from_str(json).map_err(WorkspaceError::InvalidSnapshot)?;
        if snapshot.schema_version != 1 && snapshot.schema_version != SCHEMA_VERSION {
            return Err(WorkspaceError::UnsupportedVersion(snapshot.schema_version));
        }
        // Version 1 documents have no archive flag; serde defaults it to false.
        snapshot.schema_version = SCHEMA_VERSION;
        let mut ids = HashSet::new();
        for document in &snapshot.documents {
            validate_id(&document.id)?;
            if !ids.insert(&document.id) {
                return Err(WorkspaceError::DuplicateId(document.id.clone()));
            }
        }
        Ok(Self { snapshot })
    }

    pub fn to_json(&self) -> Result<String, WorkspaceError> {
        serde_json::to_string(&self.snapshot).map_err(WorkspaceError::InvalidSnapshot)
    }

    pub fn documents(&self) -> &[Document] {
        &self.snapshot.documents
    }

    /// Creates or replaces a document without changing its identity or text bytes.
    pub fn save(&mut self, document: Document) -> Result<(), WorkspaceError> {
        validate_id(&document.id)?;
        if let Some(existing) = self
            .snapshot
            .documents
            .iter_mut()
            .find(|existing| existing.id == document.id)
        {
            *existing = document;
        } else {
            self.snapshot.documents.push(document);
        }
        Ok(())
    }

    pub fn delete(&mut self, id: &str) -> Result<(), WorkspaceError> {
        let position = self
            .snapshot
            .documents
            .iter()
            .position(|document| document.id == id)
            .ok_or_else(|| WorkspaceError::NotFound(id.to_owned()))?;
        self.snapshot.documents.remove(position);
        Ok(())
    }

    /// Archives/restores a document without changing its text or edit timestamp.
    pub fn set_archived(&mut self, id: &str, archived: bool) -> Result<(), WorkspaceError> {
        let document = self
            .snapshot
            .documents
            .iter_mut()
            .find(|document| document.id == id)
            .ok_or_else(|| WorkspaceError::NotFound(id.to_owned()))?;
        document.archived = archived;
        Ok(())
    }
}

fn validate_id(id: &str) -> Result<(), WorkspaceError> {
    if id.is_empty() || id.chars().any(char::is_whitespace) {
        return Err(WorkspaceError::InvalidId);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(id: &str, body: &str) -> Document {
        Document {
            id: id.into(),
            title: "Notes".into(),
            body: body.into(),
            updated_at: 123,
            archived: false,
        }
    }

    #[test]
    fn unicode_and_whitespace_survive_save_reload_update_and_delete() {
        let mut workspace = Workspace::default();
        let original = text("one", "  日本語 📝\n\nCafe\u{301}\t\n");
        workspace.save(original.clone()).unwrap();
        workspace.save(text("two", "Keep this")).unwrap();
        let mut reloaded = Workspace::from_json(&workspace.to_json().unwrap()).unwrap();
        assert_eq!(reloaded.documents()[0], original);
        reloaded.save(text("one", "Revised\n")).unwrap();
        assert_eq!(reloaded.documents().len(), 2);
        reloaded.delete("one").unwrap();
        assert_eq!(reloaded.documents(), &[text("two", "Keep this")]);
    }

    #[test]
    fn invalid_or_future_snapshots_are_rejected_without_mutation() {
        assert!(Workspace::from_json("not JSON").is_err());
        assert!(matches!(
            Workspace::from_json(r#"{"schemaVersion":3,"documents":[]}"#),
            Err(WorkspaceError::UnsupportedVersion(3))
        ));
        let duplicate = Snapshot {
            schema_version: SCHEMA_VERSION,
            documents: vec![text("one", "a"), text("one", "b")],
        };
        assert!(matches!(
            Workspace::from_json(&serde_json::to_string(&duplicate).unwrap()),
            Err(WorkspaceError::DuplicateId(_))
        ));
    }

    #[test]
    fn failed_operations_preserve_existing_texts() {
        let mut workspace = Workspace::default();
        workspace.save(text("one", "keep")).unwrap();
        let before = workspace.to_json().unwrap();
        assert!(workspace.save(text("bad id", "discard")).is_err());
        assert!(workspace.delete("missing").is_err());
        assert!(workspace.set_archived("missing", true).is_err());
        assert_eq!(workspace.to_json().unwrap(), before);
    }

    #[test]
    fn legacy_documents_migrate_and_archive_survives_reload_without_losing_text() {
        let legacy = r#"{"schemaVersion":1,"documents":[{"id":"one","title":"Notes","body":"  日本語 📝\n","updatedAt":123}]}"#;
        let mut workspace = Workspace::from_json(legacy).unwrap();
        let original = workspace.documents()[0].clone();
        assert!(!original.archived);
        workspace.set_archived("one", true).unwrap();
        let json = workspace.to_json().unwrap();
        let snapshot: Snapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(snapshot.schema_version, SCHEMA_VERSION);
        let mut reloaded = Workspace::from_json(&json).unwrap();
        assert!(reloaded.documents()[0].archived);
        assert_eq!(reloaded.documents()[0].body, original.body);
        assert_eq!(reloaded.documents()[0].updated_at, original.updated_at);
        reloaded.set_archived("one", false).unwrap();
        assert_eq!(reloaded.documents(), &[original]);
        reloaded.set_archived("one", true).unwrap();
        reloaded.delete("one").unwrap();
        assert!(reloaded.documents().is_empty());
    }
}
