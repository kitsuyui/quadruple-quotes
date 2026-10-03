//! Text management without UI, storage, clipboard, clock, or platform dependencies.

use serde::{Deserialize, Serialize};
use std::{collections::HashSet, error::Error, fmt};
use unicode_segmentation::UnicodeSegmentation;

pub const SCHEMA_VERSION: u32 = 2;
pub const MAX_ANALYSIS_UTF16_UNITS: usize = 100_000;
pub const MAX_DIAGNOSTICS: usize = 200;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisRequest {
    pub document_id: String,
    pub revision: u64,
    pub text: String,
    pub format: TextFormat,
    pub settings: AnalysisSettings,
    #[serde(default)]
    pub manual: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextFormat {
    Text,
    Markdown,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisSettings {
    #[serde(default)]
    pub plugins: std::collections::BTreeMap<String, bool>,
    #[serde(default)]
    pub rules: std::collections::BTreeMap<String, bool>,
    #[serde(default)]
    pub character_limit: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisResult {
    pub document_id: String,
    pub revision: u64,
    pub metrics: TextMetrics,
    pub diagnostics: Vec<Diagnostic>,
    pub dependencies: Vec<DependencyNode>,
    pub statuses: Vec<PluginStatus>,
    pub truncated: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextMetrics {
    pub characters: usize,
    pub characters_without_whitespace: usize,
    pub unicode_scalars: usize,
    pub utf16_units: usize,
    pub bytes: usize,
    pub lines: usize,
    pub words: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub plugin_id: String,
    pub rule_id: String,
    pub message: String,
    pub severity: Severity,
    pub range: TextRange,
    #[serde(default)]
    pub invalidation_scope: InvalidationScope,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestions: Option<Vec<String>>,
}
/// Context that an editor must invalidate when retaining an older diagnostic.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InvalidationScope {
    Range,
    Word,
    Sentence,
    Paragraph,
    #[default]
    Document,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Info,
    Warning,
    Error,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRange {
    pub start: usize,
    pub end: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyNode {
    pub id: usize,
    pub text: String,
    pub range: TextRange,
    pub head: Option<usize>,
    pub relation: String,
    pub sentence: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginStatus {
    pub plugin_id: String,
    pub status: PluginRunStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginRunStatus {
    Ok,
    Disabled,
    Skipped,
    Error,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDescriptor {
    pub id: String,
    pub name: String,
    pub description: String,
    pub default_enabled: bool,
    pub run_policy: RunPolicy,
    pub rules: Vec<RuleDescriptor>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleDescriptor {
    pub id: String,
    pub name: String,
    pub description: String,
    pub default_enabled: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunPolicy {
    Realtime,
    Manual,
}

pub trait AnalysisPlugin: Send + Sync {
    fn descriptor(&self) -> PluginDescriptor;
    fn analyze(&self, request: &AnalysisRequest, diagnostics: &mut Vec<Diagnostic>);
}

struct CorePlugin;
struct TyposPlugin;
struct StylePlugin;
static CORE_PLUGIN: CorePlugin = CorePlugin;
static TYPOS_PLUGIN: TyposPlugin = TyposPlugin;
static STYLE_PLUGIN: StylePlugin = StylePlugin;
fn trusted_plugins() -> [&'static dyn AnalysisPlugin; 3] {
    [&CORE_PLUGIN, &TYPOS_PLUGIN, &STYLE_PLUGIN]
}
impl AnalysisPlugin for CorePlugin {
    fn descriptor(&self) -> PluginDescriptor {
        PluginDescriptor {
            id: "core".into(),
            name: "Text health".into(),
            description: "Controls, zero-width characters, and length limits.".into(),
            default_enabled: true,
            run_policy: RunPolicy::Realtime,
            rules: vec![
                rule("core.controls", "Control characters", true),
                rule("core.zero-width", "Zero-width characters", true),
                rule("core.character-limit", "Character limit", true),
            ],
        }
    }
    fn analyze(&self, request: &AnalysisRequest, diagnostics: &mut Vec<Diagnostic>) {
        core_diagnostics(request, diagnostics);
    }
}
impl AnalysisPlugin for TyposPlugin {
    fn descriptor(&self) -> PluginDescriptor {
        PluginDescriptor {
            id: "typos".into(),
            name: "Typos".into(),
            description: "Low-noise spelling suggestions from crate-ci/typos.".into(),
            default_enabled: true,
            run_policy: RunPolicy::Realtime,
            rules: vec![rule("typos.spelling", "Spelling", true)],
        }
    }
    fn analyze(&self, request: &AnalysisRequest, diagnostics: &mut Vec<Diagnostic>) {
        typo_diagnostics(request, diagnostics);
    }
}
impl AnalysisPlugin for StylePlugin {
    fn descriptor(&self) -> PluginDescriptor {
        PluginDescriptor {
            id: "style".into(),
            name: "Style hints".into(),
            description: "Optional, conservative review hints; never an AI authorship judgement."
                .into(),
            default_enabled: false,
            run_policy: RunPolicy::Realtime,
            rules: vec![rule("style.filler", "Filler phrasing", true)],
        }
    }
    fn analyze(&self, request: &AnalysisRequest, diagnostics: &mut Vec<Diagnostic>) {
        style_diagnostics(request, diagnostics);
    }
}

pub fn analysis_catalog() -> Vec<PluginDescriptor> {
    trusted_plugins()
        .iter()
        .map(|plugin| plugin.descriptor())
        .collect()
}
fn rule(id: &str, name: &str, default_enabled: bool) -> RuleDescriptor {
    RuleDescriptor {
        id: id.into(),
        name: name.into(),
        description: name.into(),
        default_enabled,
    }
}

pub fn analyze_text(request: AnalysisRequest) -> AnalysisResult {
    let metrics = metrics(&request.text);
    let over_limit = metrics.utf16_units > MAX_ANALYSIS_UTF16_UNITS;
    let mut diagnostics = Vec::new();
    let mut statuses = Vec::new();
    for plugin in trusted_plugins() {
        let descriptor = plugin.descriptor();
        let enabled = request
            .settings
            .plugins
            .get(&descriptor.id)
            .copied()
            .unwrap_or(descriptor.default_enabled);
        if !enabled {
            statuses.push(PluginStatus {
                plugin_id: descriptor.id,
                status: PluginRunStatus::Disabled,
                message: None,
            });
            continue;
        }
        if over_limit {
            statuses.push(PluginStatus {
                plugin_id: descriptor.id,
                status: PluginRunStatus::Skipped,
                message: Some("Text exceeds the 100,000 UTF-16 unit analysis limit.".into()),
            });
            continue;
        }
        plugin.analyze(&request, &mut diagnostics);
        statuses.push(PluginStatus {
            plugin_id: descriptor.id,
            status: PluginRunStatus::Ok,
            message: None,
        });
    }
    let capped = diagnostics.len() > MAX_DIAGNOSTICS;
    diagnostics.truncate(MAX_DIAGNOSTICS);
    AnalysisResult {
        document_id: request.document_id,
        revision: request.revision,
        metrics,
        diagnostics,
        dependencies: Vec::new(),
        statuses,
        truncated: over_limit || capped,
    }
}
fn metrics(text: &str) -> TextMetrics {
    TextMetrics {
        characters: UnicodeSegmentation::graphemes(text, true).count(),
        characters_without_whitespace: UnicodeSegmentation::graphemes(text, true)
            .filter(|g| !g.chars().all(char::is_whitespace))
            .count(),
        unicode_scalars: text.chars().count(),
        utf16_units: text.encode_utf16().count(),
        bytes: text.len(),
        lines: text.lines().count().max(1),
        words: UnicodeSegmentation::unicode_words(text).count(),
    }
}
fn utf16_at(text: &str, byte: usize) -> usize {
    text[..byte].encode_utf16().count()
}
fn rule_enabled(settings: &AnalysisSettings, rule_id: &str, default: bool) -> bool {
    settings.rules.get(rule_id).copied().unwrap_or(default)
}
fn core_diagnostics(request: &AnalysisRequest, out: &mut Vec<Diagnostic>) {
    for (byte, ch) in request.text.char_indices() {
        let rule = if ch.is_control() && !matches!(ch, '\n' | '\r' | '\t') {
            Some(("controls", "Unexpected control character"))
        } else if matches!(ch, '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{FEFF}') {
            Some(("zero-width", "Zero-width character may be hard to review"))
        } else {
            None
        };
        if let Some((rule_id, message)) = rule.filter(|(rule_id, _)| {
            rule_enabled(&request.settings, &format!("core.{rule_id}"), true)
        }) {
            let start = utf16_at(&request.text, byte);
            out.push(Diagnostic {
                plugin_id: "core".into(),
                rule_id: format!("core.{rule_id}"),
                message: message.into(),
                severity: Severity::Warning,
                range: TextRange {
                    start,
                    end: start + ch.len_utf16(),
                },
                suggestions: None,
                invalidation_scope: InvalidationScope::Range,
            });
        }
    }
    if rule_enabled(&request.settings, "core.character-limit", true)
        && let Some(limit) = request
            .settings
            .character_limit
            .filter(|limit| metrics(&request.text).characters > *limit)
    {
        out.push(Diagnostic {
            plugin_id: "core".into(),
            rule_id: "core.character-limit".into(),
            message: format!("Text has more than the configured {limit} graphemes."),
            severity: Severity::Warning,
            range: TextRange {
                start: 0,
                end: request.text.encode_utf16().count(),
            },
            suggestions: None,
            invalidation_scope: InvalidationScope::Document,
        });
    }
}
struct TypoDictionary;
impl typos::Dictionary for TypoDictionary {
    fn correct_ident<'s>(
        &'s self,
        ident: typos::tokens::Identifier<'_>,
    ) -> Option<typos::Status<'s>> {
        self.correct_token(ident.token())
    }
    fn correct_word<'s>(&'s self, word: typos::tokens::Word<'_>) -> Option<typos::Status<'s>> {
        self.correct_token(word.token())
    }
}
impl TypoDictionary {
    fn correct_token<'s>(&'s self, token: &str) -> Option<typos::Status<'s>> {
        typos_dict::WORD_TRIE
            .find(&unicase::UniCase::unicode(token))
            .map(|values| {
                if values.is_empty() {
                    typos::Status::Invalid
                } else {
                    typos::Status::Corrections(values.iter().map(|value| (*value).into()).collect())
                }
            })
    }
}
fn typo_diagnostics(request: &AnalysisRequest, out: &mut Vec<Diagnostic>) {
    if !rule_enabled(&request.settings, "typos.spelling", true) {
        return;
    }
    let tokenizer = typos::tokens::Tokenizer::new();
    let dictionary = TypoDictionary;
    for typo in typos::check_str(&request.text, &tokenizer, &dictionary).take(MAX_DIAGNOSTICS) {
        let span = typo.span();
        let start = utf16_at(&request.text, span.start);
        let end = utf16_at(&request.text, span.end);
        let suggestions = match typo.corrections {
            typos::Status::Corrections(values) => {
                Some(values.into_iter().map(|value| value.into_owned()).collect())
            }
            _ => None,
        };
        out.push(Diagnostic {
            plugin_id: "typos".into(),
            rule_id: "typos.spelling".into(),
            message: format!("Possible typo: {}", typo.typo),
            severity: Severity::Warning,
            range: TextRange { start, end },
            suggestions,
            invalidation_scope: InvalidationScope::Word,
        });
    }
}
fn style_diagnostics(request: &AnalysisRequest, out: &mut Vec<Diagnostic>) {
    if !rule_enabled(&request.settings, "style.filler", true) {
        return;
    }
    let excluded = markdown_excluded_ranges(&request.text, &request.format);
    for phrase in ["It is important to note", "In conclusion"] {
        for (byte, _) in request.text.match_indices(phrase) {
            let end_byte = byte + phrase.len();
            if excluded
                .iter()
                .any(|range| range.start < end_byte && byte < range.end)
            {
                continue;
            }
            let start = utf16_at(&request.text, byte);
            out.push(Diagnostic {
                plugin_id: "style".into(),
                rule_id: "style.filler".into(),
                message: "Consider whether this stock transition adds meaning.".into(),
                severity: Severity::Info,
                range: TextRange {
                    start,
                    end: start + phrase.encode_utf16().count(),
                },
                suggestions: None,
                invalidation_scope: match request.format {
                    TextFormat::Markdown => InvalidationScope::Document,
                    TextFormat::Text => InvalidationScope::Sentence,
                },
            });
        }
    }
}
fn markdown_excluded_ranges(text: &str, format: &TextFormat) -> Vec<std::ops::Range<usize>> {
    if !matches!(format, TextFormat::Markdown) {
        return Vec::new();
    }
    use pulldown_cmark::{Event, Parser, Tag, TagEnd};
    let mut ranges = Vec::new();
    let mut code_block_start = None;
    for (event, range) in Parser::new(text).into_offset_iter() {
        match event {
            Event::Code(_) => ranges.push(range),
            Event::Start(Tag::CodeBlock(_)) => code_block_start = Some(range.start),
            Event::End(TagEnd::CodeBlock) => {
                if let Some(start) = code_block_start.take() {
                    ranges.push(start..range.end);
                }
            }
            _ => {}
        }
    }
    // Preserve link labels as prose; only their destinations are excluded.
    let mut offset = 0;
    while let Some(open) = text[offset..].find("](") {
        let start = offset + open + 2;
        if let Some(close) = text[start..].find(')') {
            ranges.push(start..start + close);
            offset = start + close + 1;
        } else {
            break;
        }
    }
    ranges
}

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

    /// Copies a saved document into an active, independently editable document.
    pub fn duplicate(
        &mut self,
        id: &str,
        new_id: &str,
        updated_at: u64,
    ) -> Result<Document, WorkspaceError> {
        validate_id(new_id)?;
        if self
            .snapshot
            .documents
            .iter()
            .any(|document| document.id == new_id)
        {
            return Err(WorkspaceError::DuplicateId(new_id.to_owned()));
        }
        let source = self
            .snapshot
            .documents
            .iter()
            .find(|document| document.id == id)
            .ok_or_else(|| WorkspaceError::NotFound(id.to_owned()))?;
        let title = if source.title.trim().is_empty() {
            "Untitled text"
        } else {
            &source.title
        };
        let document = Document {
            id: new_id.to_owned(),
            title: format!("{title} (copy)"),
            body: source.body.clone(),
            updated_at,
            archived: false,
        };
        self.snapshot.documents.push(document.clone());
        Ok(document)
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
        assert!(workspace.duplicate("missing", "copy", 456).is_err());
        assert!(matches!(
            workspace.duplicate("one", "one", 456),
            Err(WorkspaceError::DuplicateId(_))
        ));
        assert!(workspace.duplicate("one", "bad id", 456).is_err());
        assert_eq!(workspace.to_json().unwrap(), before);
    }

    #[test]
    fn duplicate_preserves_source_and_creates_an_independent_active_copy() {
        let mut workspace = Workspace::default();
        let mut original = text("one", "  日本語 📝\n\nCafe\u{301}\t\n");
        original.archived = true;
        workspace.save(original.clone()).unwrap();
        let copy = workspace.duplicate("one", "copy", 456).unwrap();
        assert_eq!(copy.id, "copy");
        assert_eq!(copy.title, "Notes (copy)");
        assert_eq!(copy.body, original.body);
        assert_eq!(copy.updated_at, 456);
        assert!(!copy.archived);
        let mut reloaded = Workspace::from_json(&workspace.to_json().unwrap()).unwrap();
        assert_eq!(reloaded.documents(), &[original.clone(), copy]);
        reloaded.save(text("copy", "Edit only the copy")).unwrap();
        assert_eq!(reloaded.documents()[0], original);
        reloaded.delete("copy").unwrap();
        assert_eq!(reloaded.documents(), &[original]);
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

    #[test]
    fn analysis_uses_utf16_ranges_and_keeps_input_unchanged() {
        let request = AnalysisRequest {
            document_id: "one".into(),
            revision: 9,
            text: "📝\u{200B} teh".into(),
            format: TextFormat::Text,
            settings: AnalysisSettings::default(),
            manual: false,
        };
        let result = analyze_text(request);
        assert_eq!(result.metrics.utf16_units, 7);
        assert!(
            result
                .diagnostics
                .iter()
                .any(|item| item.plugin_id == "core" && item.range.start == 2)
        );
        assert!(result.statuses.iter().any(|item| item.plugin_id == "typos" && matches!(item.status, PluginRunStatus::Ok)));
        assert_eq!(analysis_catalog().len(), 3);
    }

    #[test]
    fn analysis_honors_plugin_and_rule_switches() {
        let mut settings = AnalysisSettings::default();
        settings.plugins.insert("style".into(), true);
        settings.rules.insert("core.zero-width".into(), false);
        settings.rules.insert("typos.spelling".into(), false);
        settings.rules.insert("style.filler".into(), false);
        let result = analyze_text(AnalysisRequest {
            document_id: "one".into(),
            revision: 1,
            text: "\u{200B} teh In conclusion".into(),
            format: TextFormat::Text,
            settings,
            manual: true,
        });
        assert!(result.diagnostics.is_empty());
        assert!(
            result
                .statuses
                .iter()
                .all(|status| matches!(status.status, PluginRunStatus::Ok))
        );
    }

    #[test]
    fn markdown_style_skips_only_code_and_urls_with_utf16_ranges() {
        let request = AnalysisRequest {
            document_id: "one".into(),
            revision: 1,
            text: "📝 `In conclusion` https://example.test/In%20conclusion\nIn conclusion".into(),
            format: TextFormat::Markdown,
            settings: {
                let mut value = AnalysisSettings::default();
                value.plugins.insert("style".into(), true);
                value
            },
            manual: false,
        };
        let result = analyze_text(request);
        let style: Vec<_> = result
            .diagnostics
            .iter()
            .filter(|item| item.plugin_id == "style")
            .collect();
        assert_eq!(style.len(), 1);
        assert_eq!(
            style[0].range.start,
            "📝 `In conclusion` https://example.test/In%20conclusion\n"
                .encode_utf16()
                .count()
        );
    }

    #[test]
    fn plain_text_backticks_do_not_disable_style_hints() {
        let mut settings = AnalysisSettings::default();
        settings.plugins.insert("style".into(), true);
        let result = analyze_text(AnalysisRequest {
            document_id: "one".into(),
            revision: 1,
            text: "`code` In conclusion".into(),
            format: TextFormat::Text,
            settings,
            manual: false,
        });
        assert!(
            result
                .diagnostics
                .iter()
                .any(|item| item.rule_id == "style.filler")
        );
    }

    fn markdown_style_text(text: &str) -> Vec<Diagnostic> {
        let mut settings = AnalysisSettings::default();
        settings.plugins.insert("style".into(), true);
        analyze_text(AnalysisRequest {
            document_id: "one".into(),
            revision: 1,
            text: text.into(),
            format: TextFormat::Markdown,
            settings,
            manual: false,
        })
        .diagnostics
        .into_iter()
        .filter(|item| item.plugin_id == "style")
        .collect()
    }

    #[test]
    fn markdown_tilde_fence_excludes_code_but_keeps_paragraph_prose() {
        let diagnostics = markdown_style_text("~~~text\nIn conclusion\n~~~\n📝 In conclusion");
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(
            diagnostics[0].range.start,
            "~~~text\nIn conclusion\n~~~\n📝 ".encode_utf16().count()
        );
    }

    #[test]
    fn markdown_escaped_backtick_does_not_hide_following_prose() {
        let diagnostics = markdown_style_text("\\`literal backtick and In conclusion");
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(
            diagnostics[0].range.start,
            "\\`literal backtick and ".encode_utf16().count()
        );
    }

    #[test]
    fn markdown_link_destination_is_excluded_but_label_and_following_prose_are_checked() {
        let diagnostics = markdown_style_text(
            "[In conclusion](https://example.test/In-conclusion). 📝 In conclusion",
        );
        assert_eq!(diagnostics.len(), 2);
        assert_eq!(diagnostics[0].range.start, 1);
        assert_eq!(
            diagnostics[1].range.start,
            "[In conclusion](https://example.test/In-conclusion). 📝 "
                .encode_utf16()
                .count()
        );
    }

    #[test]
    fn diagnostic_cap_marks_truncation_without_changing_full_metrics() {
        let text = "\u{200B}".repeat(MAX_DIAGNOSTICS + 1);
        let result = analyze_text(AnalysisRequest {
            document_id: "one".into(),
            revision: 1,
            text: text.clone(),
            format: TextFormat::Text,
            settings: AnalysisSettings::default(),
            manual: false,
        });
        assert_eq!(result.diagnostics.len(), MAX_DIAGNOSTICS);
        assert!(result.truncated);
        assert_eq!(result.metrics.utf16_units, text.encode_utf16().count());
        assert_eq!(result.metrics.characters, MAX_DIAGNOSTICS + 1);
    }
}
