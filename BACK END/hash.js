const bcrypt = require("bcrypt");

(async () => {
  const hash = await bcrypt.hash("Software", 10);
  console.log(hash);
})();
