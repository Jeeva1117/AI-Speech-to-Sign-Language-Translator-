"""
Fine-tune T5 (flan-t5-small) on ISL Gloss Dataset
===================================================
Runs on CPU. Saves the fine-tuned model to ./models/t5-isl-gloss/
Load it later with t5_gloss_service.py by changing MODEL_NAME.

Usage:
    cd aisignlanguagetranslator2026
    venv\\Scripts\\python training\\finetune_t5.py
"""

import json
import os
import time
from pathlib import Path

import torch
from torch.utils.data import Dataset, DataLoader
from transformers import T5ForConditionalGeneration, T5Tokenizer

# ── Config ────────────────────────────────────────────────────────────────────
BASE_MODEL   = "google/flan-t5-small"   # pretrained base
DATASET_PATH = Path(__file__).parent.parent / "data" / "isl_dataset.json"
OUTPUT_DIR   = Path(__file__).parent.parent / "models" / "t5-isl-gloss"

PROMPT_PREFIX = (
    "Convert to ASL gloss (remove articles, auxiliaries, prepositions; "
    "use base verb forms; output only uppercase tokens): "
)

# Training hyper-parameters (tuned for CPU / low-end machines)
EPOCHS      = 10       # more epochs = better accuracy on small dataset
BATCH_SIZE  = 4        # low batch size for CPU memory
LR          = 5e-4     # slightly higher LR for small fine-tune
MAX_IN_LEN  = 128
MAX_OUT_LEN = 48
WARMUP_STEPS = 20
SAVE_EVERY  = 2        # save checkpoint every N epochs


# ── Dataset ───────────────────────────────────────────────────────────────────
class ISLDataset(Dataset):
    def __init__(self, data, tokenizer):
        self.tokenizer = tokenizer
        self.inputs  = []
        self.targets = []
        for item in data:
            self.inputs.append(PROMPT_PREFIX + item["input"])
            self.targets.append(item["output"])

    def __len__(self):
        return len(self.inputs)

    def __getitem__(self, idx):
        src = self.tokenizer(
            self.inputs[idx],
            max_length=MAX_IN_LEN,
            padding="max_length",
            truncation=True,
            return_tensors="pt",
        )
        tgt = self.tokenizer(
            self.targets[idx],
            max_length=MAX_OUT_LEN,
            padding="max_length",
            truncation=True,
            return_tensors="pt",
        )
        labels = tgt.input_ids.squeeze()
        # Replace padding token id with -100 so loss ignores padding
        labels[labels == self.tokenizer.pad_token_id] = -100

        return {
            "input_ids":      src.input_ids.squeeze(),
            "attention_mask": src.attention_mask.squeeze(),
            "labels":         labels,
        }


# ── Training loop ─────────────────────────────────────────────────────────────
def train():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Load data
    print(f"Loading dataset from {DATASET_PATH} …")
    with open(DATASET_PATH, encoding="utf-8") as f:
        data = json.load(f)
    print(f"  {len(data)} examples loaded.")

    # 2. Load tokenizer + model
    print(f"Loading base model '{BASE_MODEL}' …")
    tokenizer = T5Tokenizer.from_pretrained(BASE_MODEL)
    model     = T5ForConditionalGeneration.from_pretrained(BASE_MODEL)
    model.train()

    device = torch.device("cpu")   # works on any machine
    model.to(device)

    # 3. Build dataloader
    dataset    = ISLDataset(data, tokenizer)
    dataloader = DataLoader(dataset, batch_size=BATCH_SIZE, shuffle=True)

    # 4. Optimizer + scheduler
    optimizer = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=0.01)
    total_steps = EPOCHS * len(dataloader)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=total_steps, eta_min=1e-5
    )

    # 5. Training
    print(f"\nTraining for {EPOCHS} epochs …\n{'─'*50}")
    global_step = 0
    best_loss   = float("inf")

    for epoch in range(1, EPOCHS + 1):
        epoch_loss = 0.0
        t0 = time.time()

        for batch in dataloader:
            input_ids      = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            labels         = batch["labels"].to(device)

            optimizer.zero_grad()
            outputs = model(
                input_ids=input_ids,
                attention_mask=attention_mask,
                labels=labels,
            )
            loss = outputs.loss
            loss.backward()

            # Gradient clipping (prevents exploding gradients on CPU)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)

            optimizer.step()
            scheduler.step()

            epoch_loss  += loss.item()
            global_step += 1

        avg_loss = epoch_loss / len(dataloader)
        elapsed  = time.time() - t0
        print(f"Epoch {epoch:02d}/{EPOCHS}  |  loss: {avg_loss:.4f}  |  {elapsed:.1f}s")

        # Save best model
        if avg_loss < best_loss:
            best_loss = avg_loss
            _save(model, tokenizer, OUTPUT_DIR / "best")
            print(f"   ✓ New best model saved  (loss={best_loss:.4f})")

        # Periodic checkpoint
        if epoch % SAVE_EVERY == 0:
            _save(model, tokenizer, OUTPUT_DIR / f"epoch-{epoch:02d}")

    # 6. Final save
    _save(model, tokenizer, OUTPUT_DIR / "final")
    print(f"\n{'─'*50}")
    print(f"Training complete!  Best loss: {best_loss:.4f}")
    print(f"Model saved to: {OUTPUT_DIR}")


def _save(model, tokenizer, path):
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(str(path))
    tokenizer.save_pretrained(str(path))


# ── Inference test after training ─────────────────────────────────────────────
def test_inference():
    """Quick smoke-test using the saved fine-tuned model."""
    model_path = str(OUTPUT_DIR / "best")
    if not Path(model_path).exists():
        print("No trained model found. Run train() first.")
        return

    tokenizer = T5Tokenizer.from_pretrained(model_path)
    model     = T5ForConditionalGeneration.from_pretrained(model_path)
    model.eval()

    test_sentences = [
        "I am going to school",
        "She is eating an apple",
        "Please help me",
        "I need a doctor",
        "He is running fast",
    ]

    print("\n── Fine-tuned model inference ──────────────────────")
    for s in test_sentences:
        prompt = PROMPT_PREFIX + s
        inputs = tokenizer(prompt, return_tensors="pt", truncation=True, max_length=128)
        with torch.no_grad():
            out = model.generate(
                **inputs, max_new_tokens=48, num_beams=1, do_sample=False
            )
        gloss = tokenizer.decode(out[0], skip_special_tokens=True)
        print(f"  IN : {s}")
        print(f"  OUT: {gloss}\n")


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    train()
    test_inference()
