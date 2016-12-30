'use strict'
var DLModels = require('bateeq-models');
var map = DLModels.map;
var ObjectId = require('mongodb').ObjectId;
var sqlConnect = require('./sqlConnect');
var BaseManager = require('module-toolkit').BaseManager;
var MongoClient = require('mongodb').MongoClient,
    test = require('assert');
var ItemManager = require('../../src/managers/master/item-manager');
var BankManager = require('../../src/managers/master/bank-manager');
var CardTypeManager = require('../../src/managers/master/card-type-manager');
var StoreManager = require('../../src/managers/master/store-manager');
var SalesManager = require('../../src/managers/sales/sales-manager');


// var request=sqlConnect.getConnect();

module.exports = class SalesDataEtl extends BaseManager {
    constructor(db, user) {
        super(db, user);
        this.ItemManager = new ItemManager(db, user);
        this.BankManager = new BankManager(db, user);
        this.CardTypeManager = new CardTypeManager(db, user);
        this.StoreManager = new StoreManager(db, user);
        this.SalesManager = new SalesManager(db, user);

        this.collectionItem = this.ItemManager.collection;
        this.collectionBank = this.BankManager.collection;
        this.collectionStore = this.StoreManager.collection;
        this.collectionCardType = this.CardTypeManager.collection;
        this.collectionSalesManager = this.SalesManager.collection;
        this.collection = this.db.collection("sales-docs.temp");
        this.collectionLog = this.db.collection("migration.log");

    }

    CheckData() {
        return new Promise((resolve, reject) => {
            this.collectionSalesManager.find({}).toArray(function (err, sales) {
                return (sales);

            });

        });
    }

    getDataSales() {
        return new Promise((resolve, reject) => {
            sqlConnect.getConnect()
                .then((request) => {
                    var self = this;

                    var CountRows = "select count(*) as MaxLength from (select ROW_NUMBER() OVER(ORDER BY branch, nomor) AS number,branch,nomor,tanggal,shift,pos,kartu,no_krt,payment,userin,tglin,sum(qty)as totalProduct, max(TOTAL) as subTotal,max(TOTAL) as grandTotal,0 as discount,'' as reference , max(voucher) as voucher, max(cash) as cash, max(debit) as debit,max(credit) as credit from penjualan group by branch,nomor,tanggal,shift,pos,kartu,no_krt,payment,userin,tglin)a WHERE branch= 'SLO.02'";

                    request.query(CountRows, function (err, salesResult) {
                        // var a = [];
                        if (err) {
                            console.log(err);
                            reject(err);
                        }
                        else {
                            var start = new Date().getTime();

                            self.collectionLog.insert({ "_start": start });


                            var MaxLength = salesResult[0].MaxLength;
                            // var testPage = 5;
                            // self.collection.find({});
                            var dataRows = 4000;
                            var numberOfPage = Math.ceil(MaxLength / dataRows);

                            var process = [];
                            for (var i = 1; i <= numberOfPage; i++) {
                                process.push(self.migrateDataSales(request, i, dataRows))
                            }

                            Promise.all(process).then(results => {
                                // var arr = [];
                                // for (var i = 0; i <= results.length; i++) {
                                //     arr.push(results[i]);
                                // }

                                // console.log(arr);


                                // var end = new Date().getTime();

                                // var log = {
                                //     "migration": "sql to sales-docs.temp",
                                //     "_start": start,
                                //     "_end": end,
                                //     "Execution time": (end - start) + ' ms',
                                // };
                                var end = new Date().getTime();
                                var time = end - start;
                                var log = {
                                    "migration": "sql to sales-docs.temp ",
                                    "_start": start,
                                    "_end": end,
                                    "Execution time": time + ' ms',
                                };
                                self.collectionLog.updateOne({ "_start": start }, log);
                                resolve(results);


                            }).catch(error => {
                                console.log(error);
                                reject(error);
                            });
                        }
                    })
                });
        });
    }

    getDataMongo(code) {
        return new Promise((resolve, reject) => {
            this.collectionSalesManager.find({ "code": code }).toArray(function (err, sales) {
                resolve(sales);
            });

        });
    }

    getStore(branch) {
        return new Promise((resolve, reject) => {

            this.collectionStore.find({ "code": branch }).toArray(function (err, store) {
                resolve(store[0]);
            });

        });
    }

    getBanks(kartu) {
        return new Promise((resolve, reject) => {
            this.collectionBank.find({ "code": "BA-" + kartu }).toArray(function (err, Banks) {
                resolve(Banks[0]);
            });

        });
    }

    getCards(CardType) {
        return new Promise((resolve, reject) => {

            this.collectionCardType.find({ "name": CardType }).toArray(function (err, card) {

                resolve(card[0]);
            });

        });
    }


    migrateDataSales(request, pageNumber, dataRows) {
        var self = this;
        return new Promise((resolve, reject) => {

            var query = "exec pagination_sales_test " + pageNumber + "," + dataRows + " ";

            request.query(query, function (err, salesData) {
                if (!err) {
                    var tasks = [];
                    for (var sales of salesData) {
                        tasks.push(self.CreateData(request, sales));
                    }

                    Promise.all(tasks)
                        .then((task) => {
                            // self.collection.insertMany(task);
                            console.log(task);
                            resolve(task);
                        }).catch(error => {
                            console.log("Error : " + error);
                            reject(error);
                        });
                } else {
                    reject(err);
                }
            });
        });
    }

    CreateData(request, sales) {
        return new Promise((resolve, reject) => {


            var paymentType = "Cash";
            if ((sales.payment.trim() == "DEBIT CARD") || (sales.payment.trim() == "CREDIT CARD")) {
                paymentType = "Card";
            }
            else if ((sales.payment.trim() == "PARTIAL DEBIT CARD") || (sales.payment.trim() == "PARTIAL CREDIT CARD")) {
                paymentType = "Partial";
            } else {
                paymentType = "Cash";
            };

            var cardTemp = "";
            if ((sales.payment.trim() == "DEBIT CARD") || (sales.payment.trim() == "PARTIAL DEBIT CARD")) {
                cardTemp = "Debit";
            } else if ((sales.payment.trim() == "CREDIT CARD") || (sales.payment.trim() == "PARTIAL CREDIT CARD")) {
                cardTemp = "Credit";
            } else {
                cardTemp = "";
            };

            var CardType = "";
            if ((sales.no_krt[0] == 5) && ((sales.no_krt[1] == 1) || (sales.no_krt[1] == 2) || (sales.no_krt[1] == 3) || (sales.no_krt[1] == 4) || (sales.no_krt[1] == 5))) {

                CardType = "Mastercard";
            } else if ((sales.no_krt[0] == 2) && ((sales.no_krt[1] == 2) || (sales.no_krt[1] == 3) || (sales.no_krt[1] == 4) || (sales.no_krt[1] == 5) || (sales.no_krt[1] == 6) || (sales.no_krt[1] == 7))) {
                CardType = "Mastercard";

            } else if (sales.no_krt[0] == 4) {
                CardType = "Visa";

            } else {
                CardType = "";
            };

            var BankName = "-"
            if ((sales.kartu.trim() == "") && (sales.payment.toLowerCase() != "cash")) {
                BankName = "-";
            } else {
                BankName = sales.kartu.trim();
            }

            var _id = new ObjectId();

            var _stamp = new ObjectId();

            var store = this.getStore(sales.branch);
            var items = this.getItems(request, sales.branch, sales.nomor);
            var banks = this.getBanks(sales.kartu);
            var cards = this.getCards(CardType);
            var cardBanks = this.getBanks("-");


            Promise.all([store, items, banks, cards, cardBanks]).then(data => {

                var salesArr = [];
                var salesData = {
                    "_id": _id,
                    "_stamp": _stamp,
                    "_type": "sales-doc",
                    "_version": "1.0.0",
                    "_active": true,
                    "_deleted": false,
                    "_createdBy": sales.userin,
                    "_createdDate": sales.tglin,
                    "_createAgent": "manager",
                    "_updatedBy": "router",
                    "_updatedDate": new Date(),
                    "_updateAgent": "manager",
                    "code": sales.nomor,
                    "date": sales.tanggal,
                    "totalProduct": sales.totalProduct,
                    "subTotal": sales.subTotal,
                    "discount": sales.discount,
                    "grandTotal": parseInt(sales.grandTotal),
                    "reference": sales.reference,
                    "shift": parseInt(sales.shift),
                    "pos": sales.pos,

                    "storeId": data[0]._id,
                    "store": data[0],
                    "items": data[1],

                    "salesDetail":
                    {
                        "_stamp": new ObjectId(),
                        "_type": "sales-type",
                        "_version": "1.0.0",
                        "_active": true,
                        "deleted": false,
                        "_createdBy": "router",
                        "_createdDate": new Date(),
                        "_createAgent": "manager",
                        "_updatedBy": "router",
                        "_updatedDate": new Date(),
                        "_updateAgent": "manager",
                        "paymentType": paymentType,
                        "voucherId": {},
                        "voucher": {
                            "value": parseInt(sales.voucher),
                        },
                        "bankId": (paymentType == "Cash") ? {} : ((data[2]) ? data[2]._id : {}), //query penjualan.kartu
                        "bank": (paymentType == "Cash") ? {} : ((data[2]) ? data[2] : {}),
                        "cardTypeId": (cardTemp == "Debit") ? {} : ((data[3]) ? data[3]._id : {}),
                        "cardType": (cardTemp == "Debit") ? {} : ((data[3]) ? data[3] : {}),


                        // "cardTypeId": (_card) ? _card._id : {},
                        // "cardType": (_card) ? _card : {},

                        "bankCardId": (paymentType == "Cash") ? {} : ((data[4]) ? data[4]._id : {}),
                        "bankCard": (paymentType == "Cash") ? {} : ((data[4]) ? data[4] : {}),
                        "card": cardTemp,
                        "cardNumber": sales.no_krt,
                        "cardName": "",
                        "cashAmount": parseInt(sales.cash),
                        "cardAmount": parseInt(sales.debit) + parseInt(sales.credit),
                    },
                    "remark": "",
                    "isReturn": false,
                    "isVoid": false,
                }

                // this.collectionSalesManager.insert(salesData, { ordered: false })
                //     .then((result) => {
                //         resolve(result);
                //     })
                //     .catch((error) => {
                //         console.log("Error(CreateData) : " + error);
                //         reject(error);
                //     })
                salesArr.push(salesData);


                resolve(this.collection.insertMany(salesArr));


            })
        })
    }

    getStore(branch) {
        return new Promise((resolve, reject) => {

            this.collectionStore.find({ "code": branch }).toArray(function (err, store) {
                resolve(store[0]);
            });

        });
    }

    getBanks(kartu) {
        return new Promise((resolve, reject) => {
            this.collectionBank.find({ "code": "BA-" + kartu }).toArray(function (err, Banks) {
                resolve(Banks[0]);
            });

        });
    }

    getCards(CardType) {
        return new Promise((resolve, reject) => {

            this.collectionCardType.find({ "name": CardType }).toArray(function (err, card) {

                resolve(card[0]);
            });

        });
    }

    getItems(request, branch, nomor) {
        var self = this;
        return new Promise((resolve, reject) => {
            var queryfilter = 'select * from penjualan where nomor= \'' + nomor + '\' and branch= \'' + branch + '\'';
            request.query(queryfilter, function (err, sales) {
                if (err)
                    reject(err);
                else {
                    var barcodes = [];
                    for (var i = 0; i < sales.length; i++) {
                        barcodes.push(sales[i].barcode);
                    }

                    self.getItemsMongo(barcodes)
                        .then(listItem => {
                            var itemDetails = [];
                            for (var i = 0; i < sales.length; i++) {
                                for (var j = 0; j < listItem.length; j++) {
                                    if (sales[i].barcode == listItem[j].code) {
                                        var itemDetail = {
                                            "_stamp": listItem[j]._stamp,
                                            "_type": "sales-item",
                                            "_version": "1.0.0",
                                            "_active": true,
                                            "_deleted": false,
                                            "_createdBy": "router",
                                            "_createdDate": new Date(),
                                            "_createAgent": "manager",
                                            "_updatedBy": "router",
                                            "_updateAgent": "manager",
                                            "itemId": listItem[j]._id,
                                            "item": listItem[j],
                                            "promoId": "",
                                            "promo": {},
                                            "size": "",
                                            "quantity": sales[i].qty,
                                            "price": sales[i].harga,
                                            "discount1": sales[i].disc,
                                            "discount2": sales[i].disc1,
                                            "discountNominal": 0,
                                            "margin": 0,
                                            "specialDiscount": 0,
                                            "total": sales[i].subtotal,
                                            "isReturn": false,
                                            "returnItems": [],
                                        };
                                        itemDetails.push(itemDetail);
                                        break;
                                    }
                                }
                            }
                            resolve(itemDetails);
                        }).catch(error => {
                            reject(error);
                        });
                }
            });
        })
    };

    getItemsMongo(barcodes) {
        return new Promise((resolve, reject) => {
            this.collectionItem.find({ "code": { "$in": barcodes } }).toArray(function (err, items) {
                if (err)
                    reject(err);
                else
                    resolve(items);
            });
        });
    }
}
