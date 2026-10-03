use quadruple_quotes_core::{Document, Workspace};
use wasm_bindgen::prelude::*;

/// Only transports JSON; all document behavior belongs to the native Rust core.
#[wasm_bindgen]
pub struct TextWorkspace {
    inner: Workspace,
}

#[wasm_bindgen]
impl TextWorkspace {
    #[wasm_bindgen(constructor)]
    pub fn new(snapshot: Option<String>) -> Result<TextWorkspace, JsValue> {
        let inner = match snapshot {
            Some(json) => Workspace::from_json(&json).map_err(js_error)?,
            None => Workspace::default(),
        };
        Ok(Self { inner })
    }

    pub fn snapshot(&self) -> Result<String, JsValue> {
        self.inner.to_json().map_err(js_error)
    }

    pub fn save(&mut self, json: &str) -> Result<(), JsValue> {
        let document: Document = serde_json::from_str(json).map_err(js_error)?;
        self.inner.save(document).map_err(js_error)
    }

    pub fn delete(&mut self, id: &str) -> Result<(), JsValue> {
        self.inner.delete(id).map_err(js_error)
    }

    pub fn set_archived(&mut self, id: &str, archived: bool) -> Result<(), JsValue> {
        self.inner.set_archived(id, archived).map_err(js_error)
    }
}

fn js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}
