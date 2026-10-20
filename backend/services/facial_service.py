import re

WH_WORDS = {"what", "where", "when", "why", "who", "whom", "whose", "which", "how"}
YN_STARTERS = {"is", "are", "am", "was", "were", "do", "does", "did", "can", "could", "will", "would", "shall", "should", "have", "has", "had", "may", "might"}
NEG_WORDS = {"not", "cannot", "cant", "dont", "doesnt", "didnt", "wont", "never", "no", "isnt", "arent", "wasnt", "werent"}
HAPPY_WORDS = {"happy", "joy", "glad", "delighted", "excited", "wonderful", "great", "smile", "laugh", "love"}
SAD_WORDS = {"sad", "crying", "cry", "unhappy", "depressed", "sorrow", "hurt", "pain", "tears"}
ANGRY_WORDS = {"angry", "mad", "furious", "annoyed", "irritated", "hate", "rage"}

def analyze_sentence(sentence: str) -> dict:
    raw = sentence.strip()
    clean = raw.lower()
    has_question_mark = "?" in raw
    
    # Clean words
    words = re.sub(r'[^\w\s]', '', clean).split()
    if not words:
        return _neutral()

    # 1. Question checks
    first_word = words[0]
    if first_word in WH_WORDS or any(w in WH_WORDS for w in words[:3]) and has_question_mark:
        return {
            "expression": "wh_question",
            "icon": "❓",
            "eyebrows": "furrowed",
            "head_movement": "tilt_forward",
            "intensity": 0.75,
            "duration_ms": 1200
        }
    if has_question_mark or first_word in YN_STARTERS:
        if first_word in WH_WORDS or any(w in WH_WORDS for w in words):
            return {
                "expression": "wh_question",
                "icon": "❓",
                "eyebrows": "furrowed",
                "head_movement": "tilt_forward",
                "intensity": 0.75,
                "duration_ms": 1200
            }
        return {
            "expression": "yn_question",
            "icon": "🤨",
            "eyebrows": "raised",
            "head_movement": "tilt_forward",
            "intensity": 0.65,
            "duration_ms": 1200
        }

    # 2. Emotional expressions
    if any(w in ANGRY_WORDS for w in words):
        return {
            "expression": "angry",
            "icon": "😠",
            "eyebrows": "furrowed",
            "head_movement": "shake",
            "intensity": 0.85,
            "duration_ms": 1200
        }

    if any(w in SAD_WORDS for w in words):
        return {
            "expression": "sad",
            "icon": "😢",
            "eyebrows": "furrowed",
            "head_movement": "tilt_forward",
            "intensity": 0.65,
            "duration_ms": 1200
        }

    if any(w in HAPPY_WORDS for w in words):
        return {
            "expression": "happy",
            "icon": "😊",
            "eyebrows": "raised",
            "head_movement": "nod",
            "intensity": 0.8,
            "duration_ms": 1200
        }

    # 3. Negation
    clean_no_apos = re.sub(r'[^\w\s]', '', clean)
    if any(w in NEG_WORDS for w in clean_no_apos.split()) or "cannot" in clean_no_apos:
        return {
            "expression": "negative",
            "icon": "🙅",
            "eyebrows": "furrowed",
            "head_movement": "shake",
            "head_shake": True,
            "intensity": 0.7,
            "duration_ms": 1000
        }

    return _neutral()

def _neutral() -> dict:
    return {
        "expression": "neutral",
        "icon": "😐",
        "eyebrows": "neutral",
        "head_movement": "none",
        "intensity": 0.3,
        "duration_ms": 600
    }
