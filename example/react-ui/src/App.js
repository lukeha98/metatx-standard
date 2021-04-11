import React, { useState, useEffect } from "react";
import "./App.css";
import Button from "@material-ui/core/Button";
import {
  NotificationContainer,
  NotificationManager
} from "react-notifications";
import "react-notifications/lib/notifications.css";
import Web3 from "web3";
import { Biconomy, PermitClient, HTTP_CODES, RESPONSE_CODES } from "@biconomy/mexa";
import { makeStyles, responsiveFontSizes } from '@material-ui/core/styles';
import Link from '@material-ui/core/Link';
import Typography from '@material-ui/core/Typography';
import { Box, useIsFocusVisible } from "@material-ui/core";
let sigUtil = require("eth-sig-util");
const { config } = require("./config");

let web3;
let biconomy;
let provider;
let contract;
let ercForwarderClient;
let permitClient;
let daiToken;

const useStyles = makeStyles((theme) => ({
  root: {
    '& > * + *': {
      marginLeft: theme.spacing(2),
    },
  },
  link: {
    marginLeft: "5px"
  }
}));

let usdcDomainData = {
  name : "USDC Coin",
  version : "1",
  chainId : 4,
  verifyingContract : config.usdcAddress
};

function App() {
  const classes = useStyles();
  const preventDefault = (event) => event.preventDefault();
  const [quote, setQuote] = useState("This is a default quote");
  const [owner, setOwner] = useState("Default Owner Address");
  const [newQuote, setNewQuote] = useState("");
  const [selectedAddress, setSelectedAddress] = useState("");
  const [metaTxEnabled, setMetaTxEnabled] = useState(true);
  const [transactionHash, setTransactionHash] = useState("");

  useEffect(() => {
    async function init() {
      if (
        typeof window.ethereum !== "undefined" &&
        window.ethereum.isMetaMask
      ) {
        // Ethereum user detected. You can now use the provider.
        provider = window["ethereum"];
        await provider.enable();
        biconomy = new Biconomy(provider, { apiKey: config.apiKey, debug: true });
        web3 = new Web3(biconomy);

        console.log(web3);


        //contract should have been registered on the dashboard as ERC20_FORWARDER
        contract = new web3.eth.Contract(
          config.contract.abi,
          config.contract.address
        );
        daiToken = new web3.eth.Contract(config.daiABI, config.daiAddress);

        biconomy.onEvent(biconomy.READY, () => {
          // Initialize your dapp here like getting user accounts etc
          ercForwarderClient = biconomy.erc20ForwarderClient;
          permitClient = biconomy.permitClient;
          console.log(contract);
          setSelectedAddress(provider.selectedAddress);
          getQuoteFromNetwork();
          provider.on("accountsChanged", function (accounts) {
            setSelectedAddress(accounts[0]);
          });
        }).onEvent(biconomy.ERROR, (error, message) => {
          // Handle error while initializing mexa
        });


      } else {
        showErrorMessage("Metamask not installed");
      }
    }
    init();
  }, []);

  const onQuoteChange = event => {
    setNewQuote(event.target.value);
  };

  const onSubmitEIP712 = async event => {
    if (newQuote != "" && contract) {
      setTransactionHash("");
      if (metaTxEnabled) {

        const daiPermitOptions = {
          // spender: config.erc20ForwarderAddress,
          expiry: Math.floor(Date.now() / 1000 + 3600),
          allowed: true
        };

        let userAddress = selectedAddress;
        let functionSignature = contract.methods.setQuote(newQuote).encodeABI();
        console.log(functionSignature);

        let allowance = await daiToken.methods.allowance(userAddress, biconomy.erc20ForwarderAddress).call();
        if (allowance <= 0) {
          console.log("getting permit to spend dai");
          showInfoMessage(`Getting signature and permit transaction to spend dai token by ERC20 Forwarder contract ${config.erc20ForwarderAddress}`);

          //If you're not using biconomy's permit client as biconomy's member you can create your own without importing Biconomy.
          //Users need to pass provider object from window, spender address (erc20 forwarder address) and DAI's address for your network
          //permitClient = new PermitClient(provider,config.erc20ForwarderAddress,config.daiAddress);

          //OR use biconomy's permitclient member as below!
          // If you'd like to see demo for spending USDC please check the branch erc20-forwarder-ethers-demo
          // If you'd like to see demo for spending USDT please check the branch erc20-metatx-api

          //await permitClient.eip2612Permit(usdcPermitOptions);
          //This step only needs to be done once and is valid during the given deadline
          let permitTx = await permitClient.daiPermit(daiPermitOptions);
          await permitTx.wait(1);
        }



        console.log("Sending meta transaction");
        showInfoMessage("Building transaction to forward");
        // txGas should be calculated and passed here or calculate within the method
        let gasLimit = await contract.methods
          .setQuote(newQuote)
          .estimateGas({ from: userAddress });

        const builtTx = await ercForwarderClient.buildTx({
          to: config.contract.address,
          token: config.daiAddress,
          txGas: Number(gasLimit),
          data: functionSignature
        });
        const tx = builtTx.request;
        const fee = builtTx.cost;
        console.log(tx);
        console.log(fee);
        alert(`You will be charged ${fee} amount of DAI ${config.daiAddress} for this transaction`);
        showInfoMessage(`Signing message for meta transaction`);

        //signature of this method is sendTxEIP712({req, signature = null, userAddress})
        let transaction = await ercForwarderClient.sendTxEIP712({ req: tx });
        //returns an object containing code, log, message, txHash 
        console.log(transaction);
        if (transaction && transaction.txHash) {
          const receipt = await fetchMinedTransactionReceipt(transaction.txHash);
          if (receipt) {
            console.log(receipt);
            setTransactionHash(receipt.transactionHash);
            showSuccessMessage("Transaction confirmed on chain");
            getQuoteFromNetwork();
          }
        } else {
          showErrorMessage(transaction.message);
        }
      }
      else {
        console.log("Sending normal transaction");
        contract.methods
          .setQuote(newQuote)
          .send({ from: selectedAddress })
          .on("transactionHash", function (hash) {
            showInfoMessage(`Transaction sent to blockchain with hash ${hash}`);
          })
          .once("confirmation", function (confirmationNumber, receipt) {
            setTransactionHash(receipt.transactionHash);
            showSuccessMessage("Transaction confirmed");
            getQuoteFromNetwork();
          });
      }
    }
    else {
      showErrorMessage("Please enter the quote");
    }
  };

  const onSendRawTxFromBackend = async event => {
    if (newQuote != "" && contract) {
      setTransactionHash("");
      if (metaTxEnabled) {

        const daiPermitOptions = {
          expiry: Math.floor(Date.now() / 1000 + 3600),
          allowed: true
        };

        let permitTx = await permitClient.daiPermit(daiPermitOptions);
        await permitTx.wait(1);

        let userAddress = selectedAddress;
        //let functionSignature = contract.methods.setQuote(newQuote).encodeABI();
        //console.log(functionSignature);

        sendSignedRawTransaction(userAddress, newQuote);
      }
      else {
        console.log("Sending normal transaction");
        contract.methods
          .setQuote(newQuote)
          .send({ from: selectedAddress })
          .on("transactionHash", function (hash) {
            showInfoMessage(`Transaction sent to blockchain with hash ${hash}`);
          })
          .once("confirmation", function (confirmationNumber, receipt) {
            setTransactionHash(receipt.transactionHash);
            showSuccessMessage("Transaction confirmed");
            getQuoteFromNetwork();
          });
      }
    }
    else {
      showErrorMessage("Please enter the quote");
    }
  };

  const fetchMinedTransactionReceipt = (transactionHash) => {

    return new Promise((resolve, reject) => {

      var timer = setInterval(() => {
        web3.eth.getTransactionReceipt(transactionHash, (err, receipt) => {
          if (!err && receipt) {
            clearInterval(timer);
            resolve(receipt);
          }
        });
      }, 3000)

    })
  }

  const onSubmitPersonalSign = async event => {
    if (newQuote != "" && contract) {
      setTransactionHash("");
      if (metaTxEnabled) {

        const usdcPermitOptions = {
          domainData: usdcDomainData,
          value: "100000000000000000000", 
          deadline: Math.floor(Date.now() / 1000 + 3600),
        }

        let userAddress = selectedAddress;
        let functionSignature = contract.methods.setQuote(newQuote).encodeABI();
        console.log(functionSignature);
        //console.log("getting permit to spend dai");
        //showInfoMessage(`Getting signature and permit transaction to spend dai token by ERC20 Forwarder contract ${config.erc20ForwarderAddress}`);

        //If you're not using biconomy's permit client as biconomy's member you can create your own without importing Biconomy.
        //Users need to pass provider object from window, spender address (erc20 forwarder address) and DAI's address for your network
        //permitClient = new PermitClient(provider,config.erc20ForwarderAddress,config.daiAddress);

        //OR use biconomy's permitclient member as below!
        // If you'd like to see demo for spending USDC please check the branch erc20-forwarder-ethers-demo
        // If you'd like to see demo for spending USDT please check the branch erc20-metatx-api

        //This step only needs to be done once and is valid during the given deadline
        let permitTx = await permitClient.eip2612Permit(usdcPermitOptions);
        await permitTx.wait(1);

        console.log("Sending meta transaction");
        showInfoMessage("Building transaction to forward");
        //txGas should be calculated and passed here or calculate within the method

        let gasLimit = await contract.methods
          .setQuote(newQuote)
          .estimateGas({ from: userAddress });

        // USDT
        const builtTx = await ercForwarderClient.buildTx({
          to: config.contract.address,
          token: config.usdcAddress,
          txGas: Number(gasLimit),
          data: functionSignature
        });

        const tx = builtTx.request;
        const fee = builtTx.cost;

        console.log(tx);
        console.log(fee);

        showInfoMessage(`Signing message for meta transaction`);

        //signature of this method is sendTxEIP712({req, signature = null, userAddress})
        let transaction = await ercForwarderClient.sendTxPersonalSign({ req: tx });
        //returns an object containing code, log, message, txHash 
        console.log(transaction);

        const receipt = await fetchMinedTransactionReceipt(transaction.txHash);
        if (receipt) {
          console.log(receipt);
          setTransactionHash(receipt.transactionHash);
          showSuccessMessage("Transaction confirmed on chain");
          getQuoteFromNetwork();
        }

      } else {
        console.log("Sending normal transaction");
        contract.methods
          .setQuote(newQuote)
          .send({ from: selectedAddress })
          .on("transactionHash", function (hash) {
            showInfoMessage(`Transaction sent to blockchain with hash ${hash}`);
          })
          .once("confirmation", function (confirmationNumber, receipt) {
            setTransactionHash(receipt.transactionHash);
            showSuccessMessage("Transaction confirmed");
            getQuoteFromNetwork();
          });
      }
    } else {
      showErrorMessage("Please enter the quote");
    }
  };


  const getQuoteFromNetwork = () => {
    if (web3 && contract) {
      contract.methods
        .getQuote()
        .call()
        .then(function (result) {
          console.log(result);
          if (
            result &&
            result.currentQuote != undefined &&
            result.currentOwner != undefined
          ) {
            if (result.currentQuote == "") {
              showErrorMessage("No quotes set on blockchain yet");
            } else {
              setQuote(result.currentQuote);
              setOwner(result.currentOwner);
            }
          } else {
            showErrorMessage("Not able to get quote information from Network");
          }
        });
    }
  };

  const showErrorMessage = message => {
    NotificationManager.error(message, "Error", 5000);
  };

  const showSuccessMessage = message => {
    NotificationManager.success(message, "Message", 3000);
  };

  const showInfoMessage = message => {
    NotificationManager.info(message, "Info", 3000);
  };

  // contract should be registered as erc20 forwarder
  // get user signature and send raw tx along with signature type
  const sendSignedRawTransaction = async (userAddress, arg) => {
    let privateKey =
      "7b46cd568b21c7c4ee43980266c540233b68eebf21ca7fbfc9b171734fd749ac"; // process.env.privKey
    let functionSignature = contract.methods.setQuote(newQuote).encodeABI();

    let gasLimit = await contract.methods
      .setQuote(arg)
      .estimateGas({ from: userAddress });
    let txParams = {
      from: userAddress,
      gasLimit: web3.utils.toHex(gasLimit),
      to: config.contract.address,
      value: "0x0",
      data: functionSignature,
    };

    const signedTx = await web3.eth.accounts.signTransaction(
      txParams,
      `0x${privateKey}`
    );
    console.log(signedTx.rawTransaction);

    // should get user message to sign EIP712/personal for trusted and ERC forwarder approach
    // In this method tokenAddress needs to be passed, by default it will spend DAI tokens from user's wallet
    const forwardRequestData = await biconomy.getForwardRequestAndMessageToSign(
      signedTx.rawTransaction,
      //need to pass any other token address than DAI
    );

    console.log('amount of tokens charged would be' + forwardRequestData.cost);

    const request = forwardRequestData.request;
    console.log(request);

    console.log("Estimated cost in token : ", forwardRequestData.cost);
    console.log("data to sign");
    console.log(forwardRequestData);
    const signature = sigUtil.signTypedMessage(
      new Buffer.from(privateKey, "hex"),
      {
        data: forwardRequestData.eip712Format,
      },
      "V4"
    );

    let rawTransaction = signedTx.rawTransaction;

    let data = {
      signature: signature,
      rawTransaction: rawTransaction,
      signatureType: biconomy.EIP712_SIGN,
      forwardRequest: request,
    };

    // Use any one of the methods below to check for transaction confirmation
    // USING PROMISE
    /*let receipt = await web3.eth.sendSignedTransaction(data, (error, txHash) => {
        if (error) {
            return console.error(error);
        }
        console.log(txHash);
    })*/

    // USING event emitter
    let transaction = web3.eth.sendSignedTransaction(data);
    console.log(transaction);

    transaction
      .on("transactionHash", function (hash) {
        console.log(`Transaction hash is ${hash}`);
        showInfoMessage(`Transaction sent by relayer with hash ${hash}`);
      })
      .once("confirmation", function (confirmationNumber, receipt) {
        console.log(receipt);
        setTransactionHash(receipt.transactionHash);
        showSuccessMessage("Transaction confirmed on chain");
        getQuoteFromNetwork();
      });
  };

  return (
    <div className="App">
      <section className="main">
        <div className="mb-wrap mb-style-2">
          <blockquote cite="http://www.gutenberg.org/ebboks/11">
            <p>{quote}</p>
          </blockquote>
        </div>

        <div className="mb-attribution">
          <p className="mb-author">{owner}</p>
          {selectedAddress.toLowerCase() === owner.toLowerCase() && (
            <cite className="owner">You are the owner of the quote</cite>
          )}
          {selectedAddress.toLowerCase() !== owner.toLowerCase() && (
            <cite>You are not the owner of the quote</cite>
          )}
        </div>
      </section>
      <section>
        {transactionHash !== "" && <Box className={classes.root} mt={2} p={2}>
          <Typography>
            Check your transaction hash
            <Link href={`https://rinkeby.etherscan.io/tx/${transactionHash}`} target="_blank"
              className={classes.link}>
              here
            </Link>
          </Typography>
        </Box>}
      </section>
      <section>
        <div className="submit-container">
          <div className="submit-row">
            <input
              type="text"
              placeholder="Enter your quote"
              onChange={onQuoteChange}
              value={newQuote}
            />
            <Button variant="contained" color="primary" onClick={onSubmitEIP712}>
              Submit with EIP712
            </Button>
            <Button variant="contained" color="primary" onClick={onSubmitPersonalSign}>
              Submit with Personal
            </Button>
            <Button variant="contained" color="primary" onClick={onSendRawTxFromBackend}>
              send backend signed Tx
            </Button>
          </div>
        </div>
      </section>
      <NotificationContainer />
    </div>
  );
}

export default App;
