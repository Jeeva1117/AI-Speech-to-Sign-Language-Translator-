import re

STOP_WORDS = {
    "am", "is", "are", "was", "were", "be", "been", "being",
    "a", "an", "the", "to", "of", "in", "on", "at", "for",
    "with", "about", "into", "through", "during", "before", "after",
    "above", "below", "from", "up", "down", "in", "out",
    "do", "does", "did", "have", "has", "had"
}

PRONOUN_MAP = {
    "i": "ME",
    "me": "ME",
    "my": "MY",
    "you": "YOU",
    "your": "YOUR",
    "he": "HE",
    "she": "SHE",
    "it": "IT",
    "we": "WE",
    "they": "THEY",
}

LEMMA_MAP = {
    "going": "GO",
    "goes": "GO",
    "went": "GO",
    "gone": "GO",
    "eating": "EAT",
    "eats": "EAT",
    "ate": "EAT",
    "drinking": "DRINK",
    "drinks": "DRINK",
    "drank": "DRINK",
    "walking": "WALK",
    "walks": "WALK",
    "walked": "WALK",
    "running": "RUN",
    "runs": "RUN",
    "ran": "RUN",
    "studying": "STUDY",
    "studies": "STUDY",
    "studied": "STUDY",
    "learning": "LEARN",
    "learns": "LEARN",
    "learned": "LEARN",
    "working": "WORK",
    "works": "WORK",
    "worked": "WORK",
    "helping": "HELP",
    "helps": "HELP",
    "helped": "HELP",
    "sleeping": "SLEEP",
    "sleeps": "SLEEP",
    "slept": "SLEEP",
    "reading": "READ",
    "reads": "READ",
    "writing": "WRITE",
    "writes": "WRITE",
    "wrote": "WRITE",
    "waiting": "WAIT",
    "waits": "WAIT",
    "waited": "WAIT",
    "watching": "WATCH",
    "watches": "WATCH",
    "watched": "WATCH",
    "feeling": "FEEL",
    "feels": "FEEL",
    "felt": "FEEL",
    "making": "MAKE",
    "makes": "MAKE",
    "made": "MAKE",
    "seeing": "SEE",
    "sees": "SEE",
    "saw": "SEE",
    "seen": "SEE",
    "thinking": "THINK",
    "thinks": "THINK",
    "thought": "THINK",
    "talking": "TALK",
    "talks": "TALK",
    "talked": "TALK",
    "saying": "SAY",
    "says": "SAY",
    "said": "SAY",
    "telling": "TELL",
    "tells": "TELL",
    "told": "TELL",
    "buying": "BUY",
    "buys": "BUY",
    "bought": "BUY",
    "giving": "GIVE",
    "gives": "GIVE",
    "gave": "GIVE",
    "taking": "TAKE",
    "takes": "TAKE",
    "took": "TAKE",
    "asking": "ASK",
    "asks": "ASK",
    "asked": "ASK",
    "showing": "SHOW",
    "shows": "SHOW",
    "showed": "SHOW",
    "understanding": "KNOW",
    "understand": "KNOW",
    "understands": "KNOW",
    "understood": "KNOW",
}

CONTRACTIONS = {
    "don't": "do not",
    "dont": "do not",
    "doesn't": "does not",
    "doesnt": "does not",
    "didn't": "did not",
    "didnt": "did not",
    "can't": "cannot",
    "cant": "cannot",
    "cannot": "cannot",
    "won't": "will not",
    "wont": "will not",
    "i'm": "i am",
    "im": "i am",
    "you're": "you are",
    "youre": "you are",
    "we're": "we are",
    "were": "we are",
    "they're": "they are",
    "theyre": "they are",
    "it's": "it is",
    "its": "it is",
    "what's": "what is",
    "whats": "what is",
    "where's": "where is",
    "wheres": "where is",
    "who's": "who is",
    "whos": "who is",
    "how's": "how is",
    "hows": "how is",
}

def clean_and_normalize(text: str) -> list[str]:
    text = text.lower().strip()
    # Replace contractions
    words = text.split()
    expanded = []
    for w in words:
        clean_w = re.sub(r'[^\w\']', '', w)
        if clean_w in CONTRACTIONS:
            expanded.extend(CONTRACTIONS[clean_w].split())
        else:
            expanded.append(w)
    text = " ".join(expanded)
    # Strip non-alphanumeric except spaces
    text = re.sub(r'[^\w\s]', '', text)
    return text.split()

def english_to_asl_gloss(sentence: str) -> list[str]:
    words = clean_and_normalize(sentence)
    if not words:
        return []

    gloss_tokens = []
    i = 0
    n = len(words)
    while i < n:
        w = words[i]
        
        # Check negative constructions like "do not know" / "not understand"
        if w in ("not", "cannot", "no"):
            gloss_tokens.append("NOT")
            i += 1
            continue
            
        if w in STOP_WORDS:
            i += 1
            continue

        if w in PRONOUN_MAP:
            gloss_tokens.append(PRONOUN_MAP[w])
        elif w in LEMMA_MAP:
            gloss_tokens.append(LEMMA_MAP[w])
        else:
            gloss_tokens.append(w.upper())
        i += 1

    return gloss_tokens

def asl_gloss_string(sentence: str) -> str:
    tokens = english_to_asl_gloss(sentence)
    return " ".join(tokens)
