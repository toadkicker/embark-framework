contract SimpleStorage {
  uint public storedData;

  function SimpleStorage(uint initialValue) {         
     uint= initialValue;
  }

  function set(uint x) {
    storedData = x;
  }

  function get() constant returns (uint retVal) {
    return storedData;
  }

}
