use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Info,
    Hint,
}

/// How sure we are. The IDE must never present `Unverified` findings as certain.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Confidence {
    /// Deterministic fact (e.g. file does not exist, Lua syntax error).
    Certain,
    /// Backed by a measured/reported source recorded in compat-notes.json.
    Sourced,
    /// Derived from absence in the bundled snapshot; documentation may simply be missing.
    SnapshotAbsence,
    /// Heuristic; may be a false positive.
    Heuristic,
}

/// Where a problem can be reproduced.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Evidence {
    /// Found by static analysis of files only.
    Static,
    /// Only a real game client can confirm this.
    NeedsGameTest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub severity: Severity,
    pub code: String,
    pub message: String,
    /// Project-relative path with forward slashes.
    pub file: Option<String>,
    pub line: u32,
    pub col: u32,
    pub source: String,
    pub confidence: Confidence,
    pub evidence: Evidence,
}

impl Diagnostic {
    pub fn new(
        severity: Severity,
        code: &str,
        message: impl Into<String>,
        source: &str,
        confidence: Confidence,
    ) -> Self {
        Self {
            severity,
            code: code.to_string(),
            message: message.into(),
            file: None,
            line: 0,
            col: 0,
            source: source.to_string(),
            confidence,
            evidence: Evidence::Static,
        }
    }
    pub fn at(mut self, file: &str, line: u32, col: u32) -> Self {
        self.file = Some(file.to_string());
        self.line = line;
        self.col = col;
        self
    }
    pub fn needs_game(mut self) -> Self {
        self.evidence = Evidence::NeedsGameTest;
        self
    }
}
