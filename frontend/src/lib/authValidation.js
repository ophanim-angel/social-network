const emailPattern = /^[A-Za-z0-9][A-Za-z0-9._%+\-]*@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
const alphaPattern = /^[A-Za-z]+$/;
const allowedAvatarTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const maxAvatarBytes = 2 * 1024 * 1024;

export const MaxEmailLen = 254;
export const MinNameLen = 2;
export const MaxNameLen = 10;
export const MinNicknameLen = 2;
export const MaxNicknameLen = 15;
export const MinAboutMeLen = 2;
export const MaxAboutMeLen = 50;

export function isValidEmail(email) {
  const value = email.trim();
  return value.length <= MaxEmailLen && emailPattern.test(value);
}

export function isValidPassword(password) {
  if (password.length < 8 || password.length > 24) {
    return false;
  }

  let hasLetter = false;
  let hasNumber = false;
  let hasSymbol = false;

  for (const char of password) {
    const code = char.charCodeAt(0);
    if (code === 32) return false; // No spaces
    if (code < 33 || code > 126) return false; // Non-ASCII or control chars

    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
      hasLetter = true;
    } else if (code >= 48 && code <= 57) {
      hasNumber = true;
    } else {
      hasSymbol = true;
    }
  }

  return hasLetter && hasNumber && hasSymbol;
}

export function validateAuthFields(data) {
  const { email, password, first_name, last_name, nickname, about_me } = data;

  if (!isValidEmail(email)) {
    return "Email must be valid and start with a letter or digit.";
  }
  if (!isValidPassword(password)) {
    return "Password must be 8 to 24 characters, including at least 1 letter, 1 number, and 1 symbol (no spaces).";
  }
  if (first_name !== undefined && (!alphaPattern.test(first_name) || first_name.length < MinNameLen || first_name.length > MaxNameLen)) {
    return `First name must be ${MinNameLen} to ${MaxNameLen} letters (no spaces).`;
  }
  if (last_name !== undefined && (!alphaPattern.test(last_name) || last_name.length < MinNameLen || last_name.length > MaxNameLen)) {
    return `Last name must be ${MinNameLen} to ${MaxNameLen} letters (no spaces).`;
  }
  if (nickname !== undefined && nickname && (!alphaPattern.test(nickname) || nickname.length < MinNicknameLen || nickname.length > MaxNicknameLen)) {
    return `Nickname must be ${MinNicknameLen} to ${MaxNicknameLen} letters (no spaces).`;
  }
  if (about_me !== undefined && about_me && (about_me.length < MinAboutMeLen || about_me.length > MaxAboutMeLen)) {
    return `About me must be ${MinAboutMeLen} to ${MaxAboutMeLen} characters.`;
  }
  return "";
}

export function validateSafeText(value) {
  return !/[<>]/.test(value);
}

export async function validateAvatarFile(file) {
  if (!file) {
    return "";
  }
  if (!allowedAvatarTypes.has(file.type)) {
    return "Avatar must be a PNG, JPG, JPEG, WEBP, or GIF image.";
  }
  if (file.size > maxAvatarBytes) {
    return "Avatar must be under 2MB.";
  }
  if (file.size === 0) {
    return "Avatar file is empty.";
  }

  const detectedType = await detectImageType(file);
  if (detectedType !== file.type) {
    return "Avatar file content must match a PNG, JPG, JPEG, WEBP, or GIF image.";
  }

  const canDecode = await canDecodeImage(file);
  if (!canDecode) {
    return "Avatar must be a valid image file.";
  }
  return "";
}

async function detectImageType(file) {
  const bytes = new Uint8Array(await file.slice(0, 512).arrayBuffer());

  if (matchesBytes(bytes, [0x89, 0x50, 0x4e, 0x47])) {
    return "image/png";
  }
  if (matchesBytes(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    matchesBytes(bytes, [0x47, 0x49, 0x46, 0x38]) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    matchesBytes(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return "";
}

function matchesBytes(bytes, signature) {
  if (bytes.length < signature.length) {
    return false;
  }
  return signature.every((byte, index) => bytes[index] === byte);
}

function canDecodeImage(file) {
  return new Promise((resolve) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image.naturalWidth > 0 && image.naturalHeight > 0);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };
    image.src = url;
  });
}
