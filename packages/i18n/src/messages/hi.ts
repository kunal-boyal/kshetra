import type { Message } from '../translate';
import type { MessageKey } from './en';

/**
 * Hindi. A tenant's own term can be masculine or feminine and Hindi verbs agree with it, so
 * sentences keep each term where its form never changes: as a subject or object with a verb
 * that agrees with a fixed word. A native speaker reviews this text before release (spec 8.6).
 */
export const hi: Record<MessageKey, Message> = {
  'error.VALIDATION': 'कुछ जानकारी ठीक करनी है। चिह्नित फ़ील्ड देखें।',
  'error.UNAUTHENTICATED': 'जारी रखने के लिए साइन इन करें।',
  'error.TOKEN_EXPIRED': 'आपका सत्र रीफ़्रेश करना होगा। फिर कोशिश करें।',
  'error.SESSION_REVOKED': 'आप साइन आउट हो गए हैं। फिर से साइन इन करें।',
  'error.FORBIDDEN': 'आपको इसकी अनुमति नहीं है।',
  'error.OUT_OF_SCOPE': 'यह उन लोगों और जगहों से बाहर है जिनकी ज़िम्मेदारी आपकी है।',
  'error.MODULE_DISABLED': 'यह सुविधा आपके संगठन के लिए बंद है।',
  'error.USE_MOBILE_APP': 'इसके लिए मोबाइल ऐप का उपयोग करें।',
  'error.NOT_FOUND': 'यह नहीं मिला। हो सकता है इसे हटा दिया गया हो।',
  'error.CONFLICT': 'यह कहीं और बदल गया है। रीफ़्रेश करके फिर कोशिश करें।',
  'error.IDEMPOTENCY_CONFLICT':
    'यह अनुरोध पहले ही अलग जानकारी के साथ भेजा जा चुका है। इसे फिर से शुरू करें।',
  'error.DEVICE_NOT_BOUND':
    'यह फ़ोन आपके खाते के लिए पंजीकृत नहीं है। अपने मैनेजर से अपना डिवाइस रीसेट करने को कहें।',
  'error.ALREADY_PUNCHED_IN': 'आपका दिन पहले ही शुरू हो चुका है।',
  'error.NOT_ON_SHIFT': 'आप ड्यूटी पर नहीं हैं। पहले {term.punch_in} पर टैप करें।',
  'error.OUTSIDE_SHIFT': 'यह आपके ड्यूटी समय के बाहर दर्ज हुआ था, इसलिए सहेजा नहीं जा सकता।',
  'error.SHIFT_EXPIRED': 'आपका दिन सबसे लंबी अनुमत शिफ़्ट से आगे चला गया, इसलिए बंद कर दिया गया।',
  'error.GPS_MOCKED':
    'आपकी लोकेशन नकली लग रही है। लोकेशन बदलने वाला कोई भी ऐप बंद करें, फिर कोशिश करें।',
  'error.GPS_STALE': 'आपकी लोकेशन पुरानी है। नई लोकेशन मिलने तक रुकें, फिर कोशिश करें।',
  'error.GPS_INACCURATE': 'आपकी लोकेशन पर्याप्त सटीक नहीं है। खुली जगह पर जाएँ, फिर कोशिश करें।',
  'error.OUTSIDE_GEOFENCE': 'यह {term.account} आपसे बहुत दूर है।',
  'error.SYNC_WINDOW': 'यह बहुत पहले दर्ज हुआ था, इसलिए गिना नहीं जा सकता।',
  'error.PHOTO_REQUIRED': 'जारी रखने के लिए फ़ोटो जोड़ें।',
  'error.MEDIA_NOT_READY': 'एक फ़ोटो अभी अपलोड हो रही है। थोड़ी देर में अपने आप फिर कोशिश होगी।',
  'error.PRICE_CHANGED': 'कीमतें बदल गई हैं। अपनी कार्ट देखें, फिर {term.order} दोबारा भेजें।',
  'error.TARGET_LOCKED': 'यह {term.target} लॉक है। अब इसमें बदलाव नहीं हो सकता।',
  'error.NOT_CURRENT_APPROVER':
    'इस पर कार्रवाई की बारी आपकी नहीं है, या कोई और कार्रवाई कर चुका है। अपना इनबॉक्स रीफ़्रेश करें।',
  'error.QUOTA_EXCEEDED': 'यह आपकी सीमा से ज़्यादा है।',
  'error.IMPORT_ERRORS':
    'कुछ पंक्तियों में गलतियाँ हैं। उन्हें ठीक करें, फिर फ़ाइल दोबारा अपलोड करें।',
  'error.SEAT_LIMIT':
    'आपके संगठन की सभी सीटें भर गई हैं। और सीटें जोड़ने के लिए किसी एडमिन से कहें।',
  'error.TENANT_READ_ONLY':
    'आपके संगठन की सदस्यता अभी केवल देखने के लिए है। बिलिंग के बारे में किसी एडमिन से पूछें।',
  'error.TENANT_SUSPENDED':
    'आपके संगठन की सदस्यता निलंबित है। बिलिंग के बारे में किसी एडमिन से पूछें।',
  'error.RATE_LIMITED': 'बहुत ज़्यादा कोशिशें हुईं। थोड़ा रुकें, फिर कोशिश करें।',
  'error.SYNC_RESET': 'आपके फ़ोन को पूरा रीफ़्रेश करना होगा। यह अभी शुरू हो रहा है।',
  'error.OTP_INVALID': 'यह कोड सही नहीं है। जाँचकर फिर कोशिश करें।',
  'error.OTP_EXPIRED': 'इस कोड की समय-सीमा खत्म हो गई है। नया कोड मँगाएँ।',
  'error.UPGRADE_REQUIRED': 'जारी रखने के लिए ऐप अपडेट करें।',
  'error.INTERNAL': 'कुछ गड़बड़ हो गई। थोड़ी देर में फिर कोशिश करें।',

  'copy.offline_save': 'इस फ़ोन पर सहेज लिया गया। इंटरनेट मिलने पर यह अपलोड हो जाएगा।',
  'copy.pending_work':
    'सिर्फ़ स्वीकृत {term.activity:other} ही {term.target} की गिनती में शामिल हैं।',
  'copy.order_request':
    'यह {term.order} एक अनुरोध है। इसे स्वीकार करने से कोई इनवॉइस नहीं बनता, स्टॉक कम नहीं होता और इसकी गिनती बिक्री में नहीं होती।',
  'copy.ranking':
    'अनुमानित रैंकिंग। जिनके {term.target:other} लॉक नहीं हैं, उन्हें रैंक नहीं किया जाता।',
  'copy.provisional_pay': 'हाज़िरी पर आधारित अनुमान। यह वैधानिक पेरोल दस्तावेज़ नहीं है।',
  'copy.gallery_photo': 'गैलरी से चुनी गई। दिखाया गया समय और स्थान वह है जब इसे जोड़ा गया था।',
  'copy.tracking':
    'लोकेशन केवल ड्यूटी के दौरान दर्ज की जाती है। फ़ोन रीस्टार्ट करने, ऐप को ज़बरदस्ती बंद करने या बैटरी सेवर से रिकॉर्डिंग रुक सकती है।',
  'copy.finance_snapshot':
    '{date} तक के आँकड़े, {source} से। यह एक तय तारीख का स्नैपशॉट है, इसलिए भरोसा करने से पहले तारीख देख लें।',
  'copy.locked_target': 'यह {term.target} लॉक है। अब इसमें बदलाव नहीं हो सकता।',
  'copy.truncated_statement':
    'पहली {limit} एंट्री दिखाई जा रही हैं। अंतिम शेष में हर एंट्री शामिल है। अधूरा स्टेटमेंट साझा न हो, इसलिए एक्सपोर्ट बंद है।',

  'signin.title': 'साइन इन करें',
  'signin.intro': 'वही मोबाइल नंबर डालें जो आपके संगठन के पास आपका है।',
  'signin.phone_label': 'मोबाइल नंबर',
  'signin.phone_help': 'इस नंबर पर 6 अंकों का कोड भेजा जाएगा।',
  'signin.phone_invalid': 'सही मोबाइल नंबर डालें, जैसे 98765 43210।',
  'signin.send_code': 'कोड भेजें',
  'signin.code_label': 'कोड',
  'signin.code_help': '{phone} पर भेजा गया 6 अंकों का कोड डालें।',
  'signin.verify': 'साइन इन करें',
  'signin.resend': 'नया कोड भेजें',
  'signin.resend_in': {
    one: 'आप {count} सेकंड में नया कोड मँगा सकते हैं।',
    other: 'आप {count} सेकंड में नया कोड मँगा सकते हैं।',
  },
  'signin.other_number': 'दूसरा नंबर इस्तेमाल करें',
  'signin.choose_title': 'संगठन चुनें',
  'signin.choose_intro':
    'आपका नंबर एक से ज़्यादा संगठनों में है। बाद में आप मेनू से संगठन बदल सकते हैं।',

  'shell.navigation': 'मुख्य मेनू',
  'shell.home': 'होम',
  'shell.account_menu': 'आपकी प्रोफ़ाइल और सेटिंग',
  'shell.switch_organisation': 'संगठन बदलें',
  'shell.sign_out': 'साइन आउट करें',
  'shell.language': 'भाषा',
  'shell.theme': 'थीम',
  'shell.theme_light': 'हल्की',
  'shell.theme_dark': 'गहरी',
  'shell.theme_outdoor': 'उच्च कंट्रास्ट',
  'shell.skip': 'सीधे सामग्री पर जाएँ',
  'app.home': 'होम',
  'app.me': 'प्रोफ़ाइल',
  'app.organisation': 'संगठन',
  'app.display': 'डिस्प्ले',
  'app.display_system': 'फ़ोन जैसा',
  'app.display_outdoor': 'आउटडोर',
  'app.display_help': 'आउटडोर में कंट्रास्ट ज़्यादा रहता है, तेज़ धूप में काम के लिए।',
  'app.version': 'ऐप वर्ज़न {version}',
  'app.update_title': 'ऐप अपडेट करें',
  'app.update_body': 'ऐप का यह वर्ज़न अब समर्थित नहीं है। काम जारी रखने के लिए इसे अपडेट करें।',
  'app.update_action': 'स्टोर खोलें',
  'home.greeting': 'नमस्ते, {name}',
  'home.where': '{tenant} में {designation}',
  'home.empty_title': 'आपका डैशबोर्ड जल्द आ रहा है',
  'home.empty_body':
    'साइन इन, भूमिकाएँ और सेटिंग तैयार हैं। अगले चरण में: {term.activity:other}, {term.journey_plan:other} और {term.target:other}।',
  'common.loading': 'लोड हो रहा है…',
  'common.offline': 'सर्वर तक नहीं पहुँच सके। अपना कनेक्शन जाँचें, फिर कोशिश करें।',
  'common.retry': 'फिर कोशिश करें',
  'common.back': 'वापस',

  'sync.waiting': {
    one: '{count} आइटम अपलोड होने का इंतज़ार कर रहा है।',
    other: '{count} आइटम अपलोड होने का इंतज़ार कर रहे हैं।',
  },
  'sync.refused': {
    one: '{count} आइटम अस्वीकार हुआ। कारण जानने के लिए अपलोड कतार खोलें।',
    other: '{count} आइटम अस्वीकार हुए। कारण जानने के लिए अपलोड कतार खोलें।',
  },
  'sync.offline': {
    one: 'ऑफ़लाइन। {count} आइटम इस फ़ोन में सहेजा है।',
    other: 'ऑफ़लाइन। {count} आइटम इस फ़ोन में सहेजे हैं।',
  },
  'sync.view': 'देखें',

  'uploads.title': 'अपलोड कतार',
  'uploads.intro': 'इस फ़ोन में सहेजी गई जानकारी सर्वर तक पहुँचने तक यहाँ रहती है।',
  'uploads.empty_title': 'सब कुछ अपलोड हो गया है',
  'uploads.empty_body':
    'सिग्नल न होने पर आपकी सहेजी जानकारी यहाँ रहती है और सिग्नल लौटते ही अपने आप अपलोड हो जाती है।',
  'uploads.sync_now': 'अभी सिंक करें',
  'uploads.last_sync': 'पिछला सिंक {time}',
  'uploads.never_synced': 'अभी तक सिंक नहीं हुआ',
  'uploads.offline': 'सिग्नल नहीं है। सिग्नल लौटने पर सब अपने आप अपलोड हो जाएगा।',
  'uploads.queued': 'इंतज़ार में',
  'uploads.parked': 'अस्वीकार',
  'uploads.saved_at': 'सहेजा गया {time}',
  'uploads.next_try': 'अगली कोशिश {time}',
  'uploads.discard': 'हटाएँ',
  'uploads.discard_confirm': 'यह रिकॉर्ड हटाएँ? यह इस फ़ोन से मिट जाएगा और कभी अपलोड नहीं होगा।',
  'uploads.discard_yes': 'हाँ, हटाएँ',
  'uploads.discard_no': 'रहने दें',
  'uploads.item': 'रिकॉर्ड ({kind})',
  'uploads.DEPENDENCY_DISCARDED':
    'इस रिकॉर्ड के लिए ज़रूरी जानकारी हटा दी गई, इसलिए यह अपलोड नहीं हो सकता। इसे भी हटा दें।',
  'uploads.UNKNOWN_KIND': 'ऐप का यह वर्ज़न यह रिकॉर्ड अपलोड नहीं कर सकता। ऐप अपडेट करें।',
  'app.uploads': 'अपलोड कतार',
  'app.uploads_waiting': {
    one: '{count} इंतज़ार में',
    other: '{count} इंतज़ार में',
  },
  'app.uploads_done': 'सब कुछ अपलोड हो गया है',
  'app.sign_out_unsent': {
    one: '{count} रिकॉर्ड अपलोड नहीं हुआ है। यह इस फ़ोन में रहेगा और दोबारा साइन इन करने पर अपलोड होगा।',
    other:
      '{count} रिकॉर्ड अपलोड नहीं हुए हैं। ये इस फ़ोन में रहेंगे और दोबारा साइन इन करने पर अपलोड होंगे।',
  },
  'app.sign_out_anyway': 'फिर भी साइन आउट करें',
  'app.stay_signed_in': 'साइन इन रहें',
};
