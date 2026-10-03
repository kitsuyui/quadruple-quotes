use quadruple_quotes_core::{AnalysisRequest, AnalysisSettings, TextFormat, analyze_text};
use std::time::Instant;

fn request(text: String) -> AnalysisRequest {
    AnalysisRequest {
        document_id: "benchmark".into(),
        revision: 1,
        text,
        format: TextFormat::Text,
        settings: AnalysisSettings::default(),
        manual: false,
    }
}
fn exact_utf16(seed: &str, target: usize) -> String {
    let width = seed.encode_utf16().count();
    let mut text = seed.repeat(target / width);
    text.push_str(&"x".repeat(target - text.encode_utf16().count()));
    assert_eq!(text.encode_utf16().count(), target);
    text
}
fn run(name: &str, text: String) {
    let cold_started = Instant::now();
    let cold = analyze_text(request(text.clone()));
    let cold_ms = cold_started.elapsed().as_secs_f64() * 1000.0;
    let mut samples = Vec::new();
    for _ in 0..11 {
        let started = Instant::now();
        let _ = analyze_text(request(text.clone()));
        samples.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    samples.sort_by(f64::total_cmp);
    println!(
        "{}",
        serde_json::json!({"dataset":name,"utf16Units":text.encode_utf16().count(),"coldMs":cold_ms,"warmMedianMs":samples[5],"diagnostics":cold.diagnostics.len(),"truncated":cold.truncated,"metrics":cold.metrics})
    );
}
fn main() {
    run("unicode-10k", exact_utf16("📝 In conclusion. ", 10_000));
    run("unicode-100k", exact_utf16("📝 In conclusion. ", 100_000));
    run("over-limit-100001", "x".repeat(100_001));
}
