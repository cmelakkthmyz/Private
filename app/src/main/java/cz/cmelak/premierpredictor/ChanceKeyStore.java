package cz.cmelak.premierpredictor;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.nio.charset.StandardCharsets;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Encrypts a third-party PulseScore API key with Android Keystore.
 * Never use the actual Chance gambling-account password here.
 */
public final class ChanceKeyStore {
    private static final String ALIAS="sport_predictor_chance_api_v1";
    private static final String PREF="sport_predictor_secrets_v1";
    private static final String DATA="encrypted_pulse_key";
    private static final String IV="encrypted_pulse_iv";
    private ChanceKeyStore(){}
    private static SecretKey secret()throws Exception {
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        KeyStore.Entry entry=ks.getEntry(ALIAS,null);
        if(entry instanceof KeyStore.SecretKeyEntry)
            return ((KeyStore.SecretKeyEntry)entry).getSecretKey();
        KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(ALIAS,
            KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return gen.generateKey();
    }
    public static void save(Context context,String raw)throws Exception {
        String value=raw==null?"":raw.trim();
        if(value.length()<12||value.length()>512||value.matches(".*\\s.*"))
            throw new IllegalArgumentException("Neplatný klíč PulseScore. Heslo ke Chance nezadávej.");
        Cipher enc=Cipher.getInstance("AES/GCM/NoPadding");
        enc.init(Cipher.ENCRYPT_MODE,secret());
        byte[] ciphertext=enc.doFinal(value.getBytes(StandardCharsets.UTF_8));
        SharedPreferences.Editor prefs=context.getSharedPreferences(PREF,Context.MODE_PRIVATE).edit();
        prefs.putString(DATA,Base64.encodeToString(ciphertext,Base64.NO_WRAP));
        prefs.putString(IV,Base64.encodeToString(enc.getIV(),Base64.NO_WRAP));
        if(!prefs.commit())throw new IllegalStateException("Klíč nelze uložit.");
    }
    public static String load(Context context)throws Exception {
        SharedPreferences prefs=context.getSharedPreferences(PREF,Context.MODE_PRIVATE);
        String data=prefs.getString(DATA,null),iv=prefs.getString(IV,null);
        if(data==null||iv==null)return null;
        byte[] ciphertext=Base64.decode(data,Base64.DEFAULT);
        byte[] initialization=Base64.decode(iv,Base64.DEFAULT);
        if(initialization.length!=12)throw new IllegalStateException("Šifrovaný klíč je poškozen.");
        Cipher dec=Cipher.getInstance("AES/GCM/NoPadding");
        dec.init(Cipher.DECRYPT_MODE,secret(),new GCMParameterSpec(128,initialization));
        return new String(dec.doFinal(ciphertext),StandardCharsets.UTF_8);
    }
    public static void clear(Context context){
        context.getSharedPreferences(PREF,Context.MODE_PRIVATE).edit()
            .remove(DATA).remove(IV).apply();
    }
    public static boolean configured(Context context){
        return context.getSharedPreferences(PREF,Context.MODE_PRIVATE)
            .contains(DATA);
    }
}
