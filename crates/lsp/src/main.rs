//! Bounded stdio JSON-RPC adapter for the Rust core.
use quadruple_quotes_core::{
    AnalysisRequest, AnalysisSettings, Severity, TextFormat, analyze_text,
};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashMap},
    io::{self, BufRead, Read, Write},
};
const MAX_FRAME: usize = 512 * 1024;
const MAX_HEADER: usize = 8 * 1024;
const MAX_DOC: usize = 100 * 1024;
const MAX_DOCS: usize = 128;
const MAX_TOTAL: usize = 2 * 1024 * 1024;
#[derive(Clone)]
struct Doc {
    text: String,
    version: i64,
    revision: u64,
    settings: AnalysisSettings,
}
#[derive(Default)]
struct Server {
    docs: HashMap<String, Doc>,
    settings: AnalysisSettings,
}
fn main() {
    Server::default().run()
}
impl Server {
    fn run(&mut self) {
        let mut i = io::stdin().lock();
        while let Some(x) = read(&mut i) {
            self.handle(x)
        }
    }
    fn handle(&mut self, m: Value) {
        let id = m.get("id").cloned();
        let p = m.get("params").cloned().unwrap_or(Value::Null);
        match m.get("method").and_then(Value::as_str).unwrap_or("") {
            "initialize" => {
                if let Some(v) = p.get("initializationOptions").and_then(cfg) {
                    self.configure(v)
                }
                self.reply(id,json!({"capabilities":{"textDocumentSync":{"openClose":true,"change":2},"hoverProvider":false,"codeActionProvider":true}}))
            }
            "textDocument/didOpen" => self.open(&p),
            "textDocument/didChange" => self.change(&p),
            "textDocument/didClose" => {
                if let Some(u) = p.pointer("/textDocument/uri").and_then(Value::as_str) {
                    self.docs.remove(u);
                    self.note(
                        "textDocument/publishDiagnostics",
                        json!({"uri":u,"diagnostics":[]}),
                    )
                }
            }
            "workspace/didChangeConfiguration" => {
                if let Some(v) = p.get("settings").and_then(cfg) {
                    self.configure(v)
                }
            }
            "textDocument/codeAction" => self.actions(id, &p),
            "shutdown" => self.reply(id, Value::Null),
            _ => {
                if id.is_some() {
                    self.reply(id, Value::Null)
                }
            }
        }
    }
    fn open(&mut self, p: &Value) {
        let Some(t) = p.get("textDocument") else {
            return;
        };
        let (Some(u), Some(text), Some(v)) = (
            t.get("uri").and_then(Value::as_str),
            t.get("text").and_then(Value::as_str),
            t.get("version").and_then(Value::as_i64),
        ) else {
            return;
        };
        let replaced = self.docs.get(u).map_or(0, |doc| doc.text.len());
        if text.len() > MAX_DOC
            || (self.docs.len() >= MAX_DOCS && !self.docs.contains_key(u))
            || self.size() - replaced + text.len() > MAX_TOTAL
        {
            return;
        }
        self.docs.insert(
            u.into(),
            Doc {
                text: text.into(),
                version: v,
                revision: 1,
                settings: self.settings.clone(),
            },
        );
        self.publish(u)
    }
    fn change(&mut self, p: &Value) {
        let Some(u) = p.pointer("/textDocument/uri").and_then(Value::as_str) else {
            return;
        };
        let Some(v) = p.pointer("/textDocument/version").and_then(Value::as_i64) else {
            return;
        };
        let Some(old) = self.docs.get(u).cloned() else {
            return;
        };
        if v <= old.version {
            return;
        }
        let Some(cs) = p.get("contentChanges").and_then(Value::as_array) else {
            return;
        };
        let mut text = old.text.clone();
        for c in cs {
            let Some(r) = c.get("text").and_then(Value::as_str) else {
                return;
            };
            if let Some(range) = c.get("range") {
                let (Some(s), Some(e)) = (pos(&text, &range["start"]), pos(&text, &range["end"]))
                else {
                    return;
                };
                if s > e {
                    return;
                }
                text.replace_range(s..e, r)
            } else {
                text = r.into()
            }
            if text.len() > MAX_DOC {
                return;
            }
        }
        if self.size() - old.text.len() + text.len() > MAX_TOTAL {
            return;
        }
        let mut d = old;
        d.text = text;
        d.version = v;
        d.revision += 1;
        self.docs.insert(u.into(), d);
        self.publish(u)
    }
    fn configure(&mut self, v: &Value) {
        let Some(s) = policy(v) else { return };
        self.settings = s.clone();
        for d in self.docs.values_mut() {
            d.settings = s.clone()
        }
        let us: Vec<_> = self.docs.keys().cloned().collect();
        for u in us {
            self.publish(&u)
        }
    }
    fn size(&self) -> usize {
        self.docs.values().map(|d| d.text.len()).sum()
    }
    fn publish(&self, u: &str) {
        let Some(d) = self.docs.get(u) else { return };
        let r = analyze_text(AnalysisRequest {
            document_id: u.into(),
            revision: d.revision,
            text: d.text.clone(),
            format: if u.ends_with(".md") {
                TextFormat::Markdown
            } else {
                TextFormat::Text
            },
            settings: d.settings.clone(),
            manual: false,
        });
        let ds:Vec<_>=r.diagnostics.into_iter().filter(|x|x.plugin_id=="core"||x.plugin_id=="typos").map(|x|json!({"range":rng(&d.text,x.range.start,x.range.end),"severity":sev(x.severity),"source":"quadruple-quotes","code":x.rule_id,"message":x.message,"data":{"version":d.version,"fixes":x.fixes.iter().map(|f|json!({"label":f.label,"edits":f.edits.iter().map(|e|json!({"range":rng(&d.text,e.range.start,e.range.end),"expectedText":e.expected_text,"newText":e.new_text})).collect::<Vec<_>>() })).collect::<Vec<_>>()}})).collect();
        self.note(
            "textDocument/publishDiagnostics",
            json!({"uri":u,"version":d.version,"diagnostics":ds}),
        )
    }
    fn actions(&self, id: Option<Value>, p: &Value) {
        let u = p
            .pointer("/textDocument/uri")
            .and_then(Value::as_str)
            .unwrap_or("");
        let Some(d) = self.docs.get(u) else {
            self.reply(id, json!([]));
            return;
        };
        let mut a = vec![];
        for x in p
            .pointer("/context/diagnostics")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if x.pointer("/data/version").and_then(Value::as_i64) != Some(d.version) {
                continue;
            }
            for f in x
                .pointer("/data/fixes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let Some(e) = f.get("edits").and_then(Value::as_array) else {
                    continue;
                };
                if e.iter().all(|q| matches(&d.text, q)) {
                    a.push(json!({"title":f["label"],"kind":"quickfix","edit":{"documentChanges":[{"textDocument":{"uri":u,"version":d.version},"edits":e.iter().map(|q|json!({"range":q["range"],"newText":q["newText"]})).collect::<Vec<_>>()}]}}))
                }
            }
        }
        self.reply(id, json!(a))
    }
    fn reply(&self, id: Option<Value>, r: Value) {
        if let Some(id) = id {
            self.send(json!({"jsonrpc":"2.0","id":id,"result":r}))
        }
    }
    fn note(&self, m: &str, p: Value) {
        self.send(json!({"jsonrpc":"2.0","method":m,"params":p}))
    }
    fn send(&self, v: Value) {
        let b = v.to_string();
        print!("Content-Length: {}\r\n\r\n{}", b.len(), b);
        let _ = io::stdout().flush();
    }
}
fn cfg(v: &Value) -> Option<&Value> {
    v.get("quadrupleQuotes").filter(|x| x.is_object())
}
fn policy(v: &Value) -> Option<AnalysisSettings> {
    if !v
        .as_object()?
        .keys()
        .all(|key| matches!(key.as_str(), "rules" | "allowedWords"))
    {
        return None;
    }
    let mut s = AnalysisSettings::default();
    if let Some(r) = v.get("rules") {
        let mut n = BTreeMap::new();
        for (k, v) in r.as_object()? {
            n.insert(k.clone(), v.as_bool()?);
        }
        s.rules = n
    }
    if let Some(w) = v.get("allowedWords") {
        s.allowed_words = w
            .as_array()?
            .iter()
            .map(|x| x.as_str().map(str::to_owned))
            .collect::<Option<Vec<_>>>()?
    }
    Some(s)
}
fn read<R: BufRead + Read>(i: &mut R) -> Option<Value> {
    let mut n = None;
    loop {
        let l = header_line(i)?;
        if l == b"\r\n" || l == b"\n" {
            break;
        }
        let l = std::str::from_utf8(&l).ok()?.trim();
        if let Some(x) = l.strip_prefix("Content-Length:") {
            if n.is_some() {
                return None;
            }
            n = Some(x.trim().parse::<usize>().ok()?)
        }
    }
    let n = n?;
    if n == 0 || n > MAX_FRAME {
        return None;
    }
    let mut b = vec![0; n];
    i.read_exact(&mut b).ok()?;
    serde_json::from_slice(&b).ok()
}
fn header_line<R: BufRead>(i: &mut R) -> Option<Vec<u8>> {
    let mut line = Vec::with_capacity(128);
    loop {
        let buffer = i.fill_buf().ok()?;
        if buffer.is_empty() {
            return (!line.is_empty()).then_some(line);
        }
        let take = buffer
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(buffer.len(), |position| position + 1);
        if line.len().checked_add(take)? > MAX_HEADER {
            return None;
        }
        line.extend_from_slice(&buffer[..take]);
        i.consume(take);
        if line.last() == Some(&b'\n') {
            return Some(line);
        }
    }
}
fn pos(t: &str, p: &Value) -> Option<usize> {
    let (l, c) = (
        p["line"].as_u64()? as usize,
        p["character"].as_u64()? as usize,
    );
    let mut s = 0;
    for _ in 0..l {
        let r = t.get(s..)?;
        let n = r.find(['\r', '\n'])?;
        s += if r.as_bytes()[n] == b'\r' && r.as_bytes().get(n + 1) == Some(&b'\n') {
            n + 2
        } else {
            n + 1
        }
    }
    let r = t.get(s..)?;
    let e = r.find(['\r', '\n']).unwrap_or(r.len());
    let mut n = 0;
    for (i, x) in r[..e].char_indices() {
        if n == c {
            return Some(s + i);
        }
        n += x.len_utf16();
        if n > c {
            return None;
        }
    }
    (n == c).then_some(s + e)
}
fn point(t: &str, o: usize) -> Value {
    let (mut l, mut s) = (0, 0);
    while s < o {
        let r = &t[s..];
        let Some(n) = r.find(['\r', '\n']) else { break };
        let w = if r.as_bytes()[n] == b'\r' && r.as_bytes().get(n + 1) == Some(&b'\n') {
            n + 2
        } else {
            n + 1
        };
        if s + w > o {
            break;
        }
        s += w;
        l += 1
    }
    json!({"line":l,"character":t[s..o].encode_utf16().count()})
}
fn rng(t: &str, s: usize, e: usize) -> Value {
    json!({"start":point(t,s),"end":point(t,e)})
}
fn matches(t: &str, e: &Value) -> bool {
    match (pos(t, &e["range"]["start"]), pos(t, &e["range"]["end"])) {
        (Some(s), Some(x)) => t.get(s..x) == e["expectedText"].as_str(),
        _ => false,
    }
}
fn sev(s: Severity) -> u8 {
    match s {
        Severity::Error => 1,
        Severity::Warning => 2,
        Severity::Info => 3,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    #[test]
    fn cr_utf16_and_invalid_batch() {
        assert_eq!(pos("a\rb", &json!({"line":1,"character":0})), Some(2));
        assert_eq!(pos("a😀\r\nb", &json!({"line":0,"character":2})), None);
        let mut s = Server::default();
        s.open(&json!({"textDocument":{"uri":"x","version":1,"text":"abc"}}));
        s.change(&json!({"textDocument":{"uri":"x","version":2},"contentChanges":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":1}},"text":"z"},{"range":{"start":{"line":99,"character":0},"end":{"line":99,"character":0}},"text":"!"}]}));
        assert_eq!(s.docs["x"].text, "abc");
        assert_eq!(s.docs["x"].version, 1)
    }
    #[test]
    fn bounds_headers_and_replacement_totals() {
        assert!(read(&mut Cursor::new(vec![b'x'; MAX_HEADER + 1])).is_none());
        let mut s = Server::default();
        s.docs.insert(
            "x".into(),
            Doc {
                text: "a".into(),
                version: 1,
                revision: 1,
                settings: AnalysisSettings::default(),
            },
        );
        s.docs.insert(
            "filled".into(),
            Doc {
                text: "b".repeat(MAX_TOTAL),
                version: 1,
                revision: 1,
                settings: AnalysisSettings::default(),
            },
        );
        s.open(&json!({"textDocument":{"uri":"x","version":2,"text":"z".repeat(MAX_DOC)}}));
        assert_eq!(s.docs["x"].text, "a");
        assert_eq!(s.docs["x"].version, 1);
    }
    #[test]
    fn configuration_requires_the_nested_policy_and_replaces_it() {
        let mut s = Server::default();
        s.configure(&json!({"rules":{"old":true},"allowedWords":["first"]}));
        assert!(s.settings.rules["old"]);
        assert_eq!(s.settings.allowed_words, ["first"]);
        assert!(cfg(&json!({"unrelated":true})).is_none());
        s.configure(&json!({"rules":{"new":false},"allowedWords":["second"]}));
        assert!(!s.settings.rules.contains_key("old"));
        assert!(!s.settings.rules["new"]);
        assert_eq!(s.settings.allowed_words, ["second"]);
        s.configure(&json!({}));
        assert!(s.settings.rules.is_empty());
        assert!(s.settings.allowed_words.is_empty());
    }
    #[test]
    fn unknown_or_bad_configuration_retains_the_last_policy() {
        let mut s = Server::default();
        s.configure(&json!({"rules":{"old":true},"allowedWords":["first"]}));
        for invalid in [
            json!({"unrelated":true}),
            json!({"rules":{"new":false},"unrelated":true}),
            json!({"rules":{"new":"bad"}}),
            json!({"allowedWords":[false]}),
        ] {
            assert!(policy(&invalid).is_none());
            s.configure(&invalid);
            assert!(s.settings.rules["old"]);
            assert_eq!(s.settings.allowed_words, ["first"]);
        }
    }
}
