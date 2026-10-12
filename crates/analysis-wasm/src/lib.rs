use quadruple_quotes_core::{
    AnalysisRequest, DiagnosticPolicyRequest, analysis_catalog as catalog, analyze_text as analyze,
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

#[wasm_bindgen]
pub fn resolve_analysis_settings(json: &str) -> Result<String, JsValue> {
    let request: DiagnosticPolicyRequest = serde_json::from_str(json).map_err(js_error)?;
    serde_json::to_string(&quadruple_quotes_core::resolve_analysis_settings(
        &request.document_id,
        &request.settings,
    ))
    .map_err(js_error)
}

#[wasm_bindgen]
pub fn apply_diagnostic_settings(json: &str) -> Result<String, JsValue> {
    let request: DiagnosticPolicyRequest = serde_json::from_str(json).map_err(js_error)?;
    serde_json::to_string(&quadruple_quotes_core::apply_diagnostic_settings(request))
        .map_err(js_error)
}

fn js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}
