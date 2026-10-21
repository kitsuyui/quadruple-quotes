use std::io::{Read, Write};
use std::process::{Command, Stdio};

fn frame(value: &str) -> String {
    format!("Content-Length: {}\r\n\r\n{value}", value.len())
}

#[test]
fn stdio_protocol_handles_unicode_versions_large_documents_and_close() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_quadruple-quotes-lsp"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("starts LSP");
    let input = format!(
        "{}{}{}{}{}{}{}",
        frame(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#),
        frame(
            r#"{"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":{"uri":"file:///unicode.md","version":2,"text":"teh 😀\r\nword"}}}"#
        ),
        frame(
            r#"{"jsonrpc":"2.0","method":"textDocument/didChange","params":{"textDocument":{"uri":"file:///unicode.md","version":1},"contentChanges":[{"text":"ignored"}]}}"#
        ),
        frame(
            r#"{"jsonrpc":"2.0","id":2,"method":"textDocument/codeAction","params":{"textDocument":{"uri":"file:///unicode.md"},"context":{"diagnostics":[{"data":{"version":1,"fixes":[]}}]}}}"#
        ),
        frame(&format!(
            r#"{{"jsonrpc":"2.0","method":"textDocument/didOpen","params":{{"textDocument":{{"uri":"file:///large.txt","version":1,"text":"{}"}}}}}}"#,
            "a".repeat(100_001)
        )),
        frame(
            r#"{"jsonrpc":"2.0","method":"textDocument/didClose","params":{"textDocument":{"uri":"file:///unicode.md"}}}"#
        ),
        frame(r#"{"jsonrpc":"2.0","id":3,"method":"shutdown","params":{}}"#),
    );
    let mut stdout = child.stdout.take().unwrap();
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).unwrap();
        bytes
    });
    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(input.as_bytes()).unwrap();
    drop(stdin);
    assert!(child.wait().unwrap().success());
    let stdout = String::from_utf8(reader.join().unwrap()).unwrap();
    assert!(stdout.contains("textDocumentSync"));
    assert!(stdout.contains("file:///large.txt"));
    assert!(stdout.contains("\"id\":2"));
    assert!(stdout.contains("\"diagnostics\":[]"));
}
