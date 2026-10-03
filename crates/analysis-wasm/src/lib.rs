use quadruple_quotes_core::{
    AnalysisRequest, analysis_catalog as catalog, analyze_text as analyze,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn analyze_text(json: &str) -> Result<String, JsValue> {
    let request: AnalysisRequest = serde_json::from_str(json).map_err(js_error)?;
    serde_json::to_string(&analyze(request)).map_err(js_error)
}

#[wasm_bindgen]
pub fn analysis_catalog() -> Result<String, JsValue> {
    serde_json::to_string(&catalog()).map_err(js_error)
}

fn js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}
