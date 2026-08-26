package com.vsis.timesheet

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * OS-backed secure storage for the mobile session payload.
 *
 * Values are encrypted with an AES-256/GCM key generated inside the Android
 * Keystore (non-exportable, user-authentication not required so background
 * token refresh keeps working). Only the IV + ciphertext pair is persisted,
 * in app-private SharedPreferences; no key material ever leaves the keystore.
 */
class VsisSecureStorageModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "VsisSecureStorage"

  private val prefs by lazy {
    reactApplicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
  }

  private fun secretKey(): SecretKey {
    val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    generator.init(
        KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(false)
            .build(),
    )
    return generator.generateKey()
  }

  private fun encrypt(value: String): String {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, secretKey())
    val iv = cipher.iv
    val ciphertext = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    return Base64.encodeToString(iv, Base64.NO_WRAP) +
        SEPARATOR +
        Base64.encodeToString(ciphertext, Base64.NO_WRAP)
  }

  private fun decrypt(stored: String): String {
    val parts = stored.split(SEPARATOR)
    if (parts.size != 2) throw IllegalArgumentException("Corrupt secure-storage entry.")
    val iv = Base64.decode(parts[0], Base64.NO_WRAP)
    val ciphertext = Base64.decode(parts[1], Base64.NO_WRAP)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
    return String(cipher.doFinal(ciphertext), Charsets.UTF_8)
  }

  @ReactMethod
  fun set(service: String, key: String, value: String, promise: Promise) {
    try {
      prefs.edit().putString(storageKey(service, key), encrypt(value)).apply()
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("SECURE_STORAGE_WRITE_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun get(service: String, key: String, promise: Promise) {
    try {
      val stored = prefs.getString(storageKey(service, key), null)
      if (stored == null) {
        promise.resolve(null)
        return
      }
      // A corrupt entry is removed instead of failing every cold start.
      promise.resolve(decrypt(stored))
    } catch (error: Exception) {
      prefs.edit().remove(storageKey(service, key)).apply()
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun remove(service: String, key: String, promise: Promise) {
    try {
      val existed = prefs.getString(storageKey(service, key), null) != null
      prefs.edit().remove(storageKey(service, key)).apply()
      promise.resolve(existed)
    } catch (error: Exception) {
      promise.reject("SECURE_STORAGE_REMOVE_FAILED", error.message, error)
    }
  }

  companion object {
    private const val PREFS_NAME = "vsis_secure_storage"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "vsis_secure_storage_key"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS = 128
    private const val SEPARATOR = ":"
    private fun storageKey(service: String, key: String): String = "$service.$key"
  }
}
