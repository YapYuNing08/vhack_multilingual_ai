import base64
import os
from groq import Groq

# Using the fast 11B vision model
VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"

def analyze_document_image(image_bytes: bytes, language: str) -> str:
    """
    Sends an image to Groq's Vision model and returns a simplified explanation.
    """
    # 1. Convert the image bytes to base64 so Groq can read it
    base64_image = base64.b64encode(image_bytes).decode('utf-8')
    
    # 2. Map the language code to the full name
    lang_map = {
        "en": "English",
        "ms": "Bahasa Malaysia",
        "zh": "Simplified Chinese",
        "ta": "Tamil",
        "id": "Bahasa Indonesia",
    }
    ui_language = lang_map.get(language, "English")

    # 3. The Vision Prompt
    prompt = f"""
    You are SilaSpeak, an AI helping Malaysian citizens understand physical government letters, bills, and notices.
    Look at the attached image of this document.
    
    1. Identify who sent it (e.g., LHDN, JPJ, Hospital, Ministry).
    2. Extract any important dates, deadlines, or appointment times.
    3. Explain the main purpose of the document in very simple, 5th-grade terms.
    4. Tell the user what action they need to take (if any) in 3 actionable bullet points.
    
    CRITICAL RULE: You MUST write your ENTIRE response in {ui_language}. 
    DO NOT print any translation labels.
    """

    client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

    print(f"[Vision] Sending image to {VISION_MODEL} in {ui_language}...")
    
    try:
        response = client.chat.completions.create(
            model=VISION_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}"
                            }
                        }
                    ]
                }
            ],
            temperature=0.1,
            max_tokens=1024,
        )
        answer = response.choices[0].message.content.strip()
        
        print("\n" + "="*50)
        print(f"👁️ VISION AI RESPONSE:\n{answer}")
        print("="*50 + "\n")
        
        return answer
        
    except Exception as e:
        print(f"[Vision] Error: {e}")
        return f"Sorry, I encountered an error reading the image: {str(e)}"