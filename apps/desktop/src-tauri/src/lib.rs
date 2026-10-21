use std::{fs, fs::File, io::Read, path::PathBuf};

use serde::Serialize;

const MAX_IMPORT_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectedFile {
    name: String,
    bytes: Vec<u8>,
}

fn safe_filename(name: &str) -> String {
    let stem: String = name
        .chars()
        .filter(|character| {
            !character.is_control()
                && !matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
        })
        .take(100)
        .collect();
    let trimmed =
        stem.trim_matches(|character: char| character == '.' || character.is_whitespace());
    if trimmed.is_empty() {
        "Quadruple Quotes.txt".to_owned()
    } else {
        trimmed.to_owned()
    }
}

#[tauri::command]
fn pick_file() -> Result<Option<SelectedFile>, String> {
    let selected = rfd::FileDialog::new()
        .add_filter("Supported text files", &["txt", "md", "json"])
        .pick_file();
    let Some(path) = selected else {
        return Ok(None);
    };
    let bytes = read_selected_file(&path)?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "The selected filename is not valid UTF-8.".to_owned())?;
    Ok(Some(SelectedFile {
        name: name.to_owned(),
        bytes,
    }))
}

fn read_selected_file(path: &std::path::Path) -> Result<Vec<u8>, String> {
    let mut file =
        File::open(path).map_err(|error| format!("Could not open the selected file: {error}"))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("Could not inspect the selected file: {error}"))?;
    if !metadata.is_file() {
        return Err("The selected path is not a regular file.".to_owned());
    }
    let mut bytes = Vec::with_capacity(metadata.len().min(MAX_IMPORT_BYTES) as usize);
    file.by_ref()
        .take(MAX_IMPORT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read the selected file: {error}"))?;
    if bytes.len() as u64 > MAX_IMPORT_BYTES {
        return Err("The selected file exceeds the 10 MiB workspace import limit.".to_owned());
    }
    Ok(bytes)
}

#[tauri::command]
fn save_file(name: String, text: String, _mime: String) -> Result<(), String> {
    let suggested = safe_filename(&name);
    let path: Option<PathBuf> = rfd::FileDialog::new().set_file_name(suggested).save_file();
    let Some(path) = path else { return Ok(()) };
    fs::write(path, text.as_bytes())
        .map_err(|error| format!("Could not save the selected file: {error}"))
}

#[tauri::command]
fn read_clipboard() -> Result<String, String> {
    arboard::Clipboard::new()
        .and_then(|mut clipboard| clipboard.get_text())
        .map_err(|error| format!("Clipboard is unavailable: {error}"))
}

#[tauri::command]
fn write_clipboard(text: String) -> Result<(), String> {
    arboard::Clipboard::new()
        .and_then(|mut clipboard| clipboard.set_text(text))
        .map_err(|error| format!("Clipboard is unavailable: {error}"))
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            pick_file,
            save_file,
            read_clipboard,
            write_clipboard
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Quadruple Quotes desktop host");
}

#[cfg(test)]
mod tests {
    use super::{read_selected_file, safe_filename, MAX_IMPORT_BYTES};
    use std::{fs, io::Write};

    #[test]
    fn makes_save_suggestion_safe() {
        assert_eq!(safe_filename("  report: draft?.txt  "), "report draft.txt");
        assert_eq!(safe_filename("..."), "Quadruple Quotes.txt");
    }

    #[test]
    fn bounded_reader_rejects_limit_plus_one() {
        let path = std::env::temp_dir().join("qq-desktop-import-limit-test.txt");
        let mut file = fs::File::create(&path).unwrap();
        file.write_all(&vec![b'x'; MAX_IMPORT_BYTES as usize + 1])
            .unwrap();
        assert!(read_selected_file(&path).is_err());
        fs::remove_file(path).unwrap();
    }
}
