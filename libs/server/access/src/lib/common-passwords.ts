/**
 * The most common passwords, lower case, refused whatever their case (a short built-in list, as
 * the password policy says; a longer list can replace it without other changes).
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234', 'password12345', 'passw0rd', 'p@ssword',
  'p@ssw0rd', 'passwort', 'contrasena', 'motdepasse', 'iloveyou', 'iloveyou1', 'letmein', 'letmein123',
  'welcome', 'welcome1', 'welcome123', 'welcome12', 'monkey123', 'dragon1234', 'sunshine123', 'princess123',
  'football123', 'baseball123', 'superman123', 'batman12345', 'trustno1234', 'qwerty123456', 'qwertyuiop',
  'qwertyuiop123', 'asdfghjkl123', 'asdfghjklzxc', 'zxcvbnm12345', '1q2w3e4r5t6y', '1qaz2wsx3edc',
  'abc123456789', 'abcd1234efgh', 'abcdefghijkl', 'abcdefg12345', 'aaaaaaaaaaaa', '111111111111',
  '123456789012', '1234567890123', '000000000000', '123123123123', '12345678901234', 'changeme',
  'changeme123', 'changeme1234', 'default12345', 'administrator', 'administrator1', 'admin1234567',
  'adminadmin123', 'rootroot1234', 'toor1234toor', 'secret12345', 'secretpassword', 'mysecret1234',
  'qazwsxedcrfv', '654321654321', 'master123456', 'access12345', 'hello12345678', 'freedom12345',
  'whatever1234', 'ninja123456', 'shadow123456', 'michael12345', 'jennifer1234', 'hunter212345',
  'computer1234', 'internet1234', 'starwars1234', 'pokemon12345', 'liverpool123', 'arsenal12345',
  'chelsea12345', 'manchester1', 'qwerty1234567', 'letmein12345', 'iloveyou12345', 'passpass1234',
  'testtest1234', 'test1234test', 'taleart12345', 'taleart123456', 'tale1234tale', 'welcometale1',
  'lovelove1234', 'summer202420', 'winter2024win', 'spring2024spr', 'autumn2024au', 'january20241',
  'monday123456', 'trustme12345', 'pa55word1234', 'pass1234word', 'mypassword12', 'mypassword123',
  'thepassword12', 'iamthebest123', 'godislove123', 'helloworld123', 'qweasdzxc123', 'abc12345abc1',
]);
