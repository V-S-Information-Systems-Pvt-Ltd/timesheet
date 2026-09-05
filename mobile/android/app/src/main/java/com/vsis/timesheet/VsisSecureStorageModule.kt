package com.vsis.timesheet

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyStore
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class VsisSecureStorageModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "VsisSecureStorage"

  private val prefs: SharedPreferences by lazy {
    reactApplicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
  }

  private fun getOrCreateKey(): SecretKey {
    val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    if (keyStore.containsAlias(KEY_ALIAS)) {
      val entry = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry
      if (entry != null) {
        return entry.secretKey
      }
    }

    val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    val spec = KeyGenParameterSpec.Builder(
      KEY_ALIAS,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .build()

    keyGenerator.init(spec)
    return keyGenerator.generateKey()
  }

  /**
   * Rejections carry one of the JavaScript contract codes from
   * mobile/src/platform/secure-storage/types.ts. The message is generic and
   * never includes the exception text, so provider and key detail cannot leak
   * to JavaScript (which discards messages anyway) or into a crash report.
   */
  private fun reject(promise: Promise, code: String) {
    promise.reject(code, "Secure credential operation failed.")
  }

  @ReactMethod
  fun read(promise: Promise) {
    val encryptedPayload = prefs.getString(KEY_PAYLOAD, null)
    val ivString = prefs.getString(KEY_IV, null)

    if (encryptedPayload == null || ivString == null) {
      promise.resolve(null)
      return
    }

    try {
      val key = getOrCreateKey()
      val cipher = Cipher.getInstance(TRANSFORMATION)
      val iv = Base64.decode(ivString, Base64.NO_WRAP)
      val spec = GCMParameterSpec(GCM_TAG_LENGTH, iv)
      cipher.init(Cipher.DECRYPT_MODE, key, spec)

      val ciphertext = Base64.decode(encryptedPayload, Base64.NO_WRAP)
      val plaintextBytes = cipher.doFinal(ciphertext)
      val plaintext = String(plaintextBytes, Charsets.UTF_8)
      promise.resolve(plaintext)
    } catch (e: KeyPermanentlyInvalidatedException) {
      // The biometric/lock-screen change that invalidated the key is transient
      // from the user's perspective; surface it as `locked` so the UI can prompt
      // rather than showing a permanent read failure.
      reject(promise, "locked")
    } catch (e: AEADBadTagException) {
      // Ciphertext or IV is corrupt, or the key was rotated under us. Self-heal
      // by clearing so the app is not permanently stuck unreadable, and tell
      // the caller it was corrupt.
      clearCredentialSafely()
      reject(promise, "corrupt")
    } catch (e: Exception) {
      reject(promise, "read-failed")
    }
  }

  @ReactMethod
  fun write(payload: String, promise: Promise) {
    try {
      val key = getOrCreateKey()
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.ENCRYPT_MODE, key)

      val iv = cipher.iv
      val ciphertext = cipher.doFinal(payload.toByteArray(Charsets.UTF_8))

      val ivString = Base64.encodeToString(iv, Base64.NO_WRAP)
      val encryptedPayload = Base64.encodeToString(ciphertext, Base64.NO_WRAP)

      // commit() is synchronous so ciphertext and IV land together — a crash
      // between the two writes (apply()'s async window) can no longer leave an
      // inconsistent pair that reads back as corrupt.
      val applied = prefs.edit()
        .putString(KEY_PAYLOAD, encryptedPayload)
        .putString(KEY_IV, ivString)
        .commit()

      if (!applied) {
        reject(promise, "write-failed")
        return
      }
      promise.resolve(null)
    } catch (e: Exception) {
      reject(promise, "write-failed")
    }
  }

  private fun clearCredentialSafely(): Boolean {
    return prefs.edit().clear().commit()
  }

  @ReactMethod
  fun clear(promise: Promise) {
    try {
      if (!clearCredentialSafely()) {
        reject(promise, "delete-failed")
        return
      }
      promise.resolve(null)
    } catch (e: Exception) {
      reject(promise, "delete-failed")
    }
  }

  @ReactMethod
  fun clearLegacy(promise: Promise) {
    // No Android legacy artifact has been identified, so this is an idempotent
    // no-op by design. The JS contract is preserved (mobile-native.ts calls it
    // before every read/write); if a legacy file is ever introduced it must be
    // removed here, never logged.
    promise.resolve(null)
  }

  @ReactMethod
  fun readWorkspace(promise: Promise) {
    try {
      val url = prefs.getString(KEY_WORKSPACE, null)
      promise.resolve(url ?: "")
    } catch (e: Exception) {
      promise.resolve("")
    }
  }

  @ReactMethod
  fun writeWorkspace(url: String, promise: Promise) {
    try {
      prefs.edit().putString(KEY_WORKSPACE, url).apply()
      promise.resolve(null)
    } catch (e: Exception) {
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun clearWorkspace(promise: Promise) {
    try {
      prefs.edit().remove(KEY_WORKSPACE).apply()
      promise.resolve(null)
    } catch (e: Exception) {
      promise.resolve(null)
    }
  }

  companion object {
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "VsisTimesheetSecureStorageKey"
    private const val PREFS_NAME = "vsis_secure_storage_prefs"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_LENGTH = 128
    private const val KEY_PAYLOAD = "encrypted_payload"
    private const val KEY_IV = "initialization_vector"
    private const val KEY_WORKSPACE = "workspace_url"
  }
}
