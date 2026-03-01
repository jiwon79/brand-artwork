Bean Image Assets
=================

Place the following image files in this directory:

  bean_front.png  — 원두 앞면 이미지 (coffee bean front face)
  bean_back.png   — 원두 뒷면 이미지 (coffee bean back face)

Requirements:
- Format: PNG (transparent background recommended)
- Size: Any square dimension (e.g. 64×64, 128×128, 256×256)
- The images should be clearly different in brightness:
    bean_front.png → lighter (represents bright logo pixels)
    bean_back.png  → darker  (represents dark logo pixels)

If these files are not found, the app will automatically render
coffee bean shapes using the HTML5 Canvas API as a fallback.
